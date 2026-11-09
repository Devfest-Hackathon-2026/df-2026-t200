"""解析と Q&A の組み立て。HTTP の扱い（main.py）と、生成（解析器）・保存（store）をつなぐ。

解析器は Gemini 版とデモ版を同じ形で差し替えられる。論文ごとの demo フラグで選ぶので、
デモモードで作った論文はあとから認証情報を設定してもデモのまま答える（逆も同じ）。
run_analysis(paper_id) は何度呼ばれても同じ結果になる（Cloud Tasks の再試行で呼ばれる前提）。
"""

import logging
import random
import threading
from collections.abc import Callable, Mapping
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime
from types import ModuleType
from typing import Any, Protocol

from pydantic import ValidationError

from . import config, errors, mock, quiz, store
from .check_service import ConceptCheckService
from .errors import PaperNotFound, QuotaExceeded, RateLimited
from .foundations import check_foundations
from .heartbeat import Heartbeat
from .pdf_utils import extract_pages, normalize, verify_all
from .quota import DailyQuota
from .ratelimit import RateLimiter
from .schemas import Paper, QuizPick

log = logging.getLogger("paper")

STEP_KEYS = ("step1", "step2", "step3")


@dataclass(frozen=True)
class PaperSource:
    """解析器に渡す材料。Gemini 版は PDF 本体を、デモ版は抽出したページを使う。"""

    paper: Paper
    pdf_bytes: bytes
    pages: list[str]
    norm_pages: list[str]


class Analyzer(Protocol):
    def step1(self, src: PaperSource) -> dict[str, Any]: ...
    def step2(self, src: PaperSource, s1: dict[str, Any]) -> dict[str, Any]: ...
    def step3(self, src: PaperSource, s1: dict[str, Any]) -> dict[str, Any]: ...
    def ask(self, src: PaperSource, question: str, history: list[dict[str, Any]], current_step: int | None) -> dict[str, Any]: ...
    def rewrite(self, paper: Paper, targets: list[dict[str, Any]]) -> dict[str, Any]: ...
    def check(self, src: PaperSource, targets: list[dict[str, Any]]) -> dict[str, Any]: ...


class DemoAnalyzer:
    """認証情報がないときのサンプル解析（mock）。"""

    def step1(self, src: PaperSource) -> dict[str, Any]:
        return mock.step1(src.pages, src.paper.filename)

    def step2(self, src: PaperSource, s1: dict[str, Any]) -> dict[str, Any]:
        return mock.step2(src.pages)

    def step3(self, src: PaperSource, s1: dict[str, Any]) -> dict[str, Any]:
        return mock.step3(src.pages)

    def ask(self, src: PaperSource, question: str, history: list[dict[str, Any]], current_step: int | None) -> dict[str, Any]:
        return mock.ask(src.pages, question)

    def rewrite(self, paper: Paper, targets: list[dict[str, Any]]) -> dict[str, Any]:
        return mock.quiz_rewrite(targets, paper.lang)

    def check(self, src: PaperSource, targets: list[dict[str, Any]]) -> dict[str, Any]:
        return mock.concept_check(src.pages, targets)


class GeminiAnalyzer:
    """Gemini 版。クライアントは最初に使うときに1つだけ作り、この解析器が持つ。"""

    def __init__(self) -> None:
        self._client: Any = None
        self._lock = threading.Lock()

    @staticmethod
    def _gemini() -> ModuleType:
        from . import gemini  # 認証情報がないデモモードでは読み込まない

        return gemini

    def _cli(self) -> Any:
        with self._lock:
            if self._client is None:
                self._client = self._gemini().client()
            return self._client

    def step1(self, src: PaperSource) -> dict[str, Any]:
        return self._gemini().step1(src.pdf_bytes, src.paper.level, lang=src.paper.lang, cli=self._cli())

    def step2(self, src: PaperSource, s1: dict[str, Any]) -> dict[str, Any]:
        return self._gemini().step2(src.pdf_bytes, src.paper.level, s1, lang=src.paper.lang, cli=self._cli())

    def step3(self, src: PaperSource, s1: dict[str, Any]) -> dict[str, Any]:
        return self._gemini().step3(src.pdf_bytes, src.paper.level, s1, lang=src.paper.lang, cli=self._cli())

    def ask(self, src: PaperSource, question: str, history: list[dict[str, Any]], current_step: int | None) -> dict[str, Any]:
        return self._gemini().ask(src.pdf_bytes, src.paper.level, question, history, current_step, lang=src.paper.lang, cli=self._cli())

    def rewrite(self, paper: Paper, targets: list[dict[str, Any]]) -> dict[str, Any]:
        return self._gemini().quiz_rewrite(targets, paper.level, lang=paper.lang, cli=self._cli())

    def check(self, src: PaperSource, targets: list[dict[str, Any]]) -> dict[str, Any]:
        return self._gemini().concept_check(src.pdf_bytes, targets, src.paper.level, lang=src.paper.lang, cli=self._cli())


def _generate_step(analyzer: Analyzer, key: str, src: PaperSource, results: dict[str, Any]) -> dict[str, Any]:
    if key == "step1":
        return analyzer.step1(src)
    if key == "step2":
        return analyzer.step2(src, results["step1"])
    return analyzer.step3(src, results["step1"])


def finalize_step(key: str, out: dict[str, Any], norm_pages: list[str]) -> dict[str, Any]:
    """解析結果を PDF と照合する。Step 1 は、照合の結果に依存する確認（先に読むとよい論文）も行う。デモモードも同じ経路を通る。"""
    verified = verify_all(out, norm_pages)
    return check_foundations(verified, norm_pages) if key == "step1" else verified


def last_alive(paper: dict[str, Any]) -> datetime | None:
    """解析のスレッドが最後に生きていた時刻。heartbeat_at、無ければ updated_at、created_at の順。読めなければ None。"""
    stamp = paper.get("heartbeat_at") or paper.get("updated_at") or paper.get("created_at")
    try:
        return datetime.fromisoformat(stamp)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def is_stale(paper: dict[str, Any], now: datetime | None = None) -> bool:
    """STALE_AFTER_SEC（既定10分）より長く更新がない。引き継ぎ（TAKEOVER_AFTER_SEC）が働かなかったときの保険で、手動の再実行を許す。"""
    last = last_alive(paper)
    if last is None:
        return True
    return ((now or datetime.now(UTC)) - last).total_seconds() > config.STALE_AFTER_SEC


CANCELLED = "cancelled"


def running(paper: dict[str, Any]) -> bool:
    """解析待ち・解析中（queued / processing_*）。"""
    status = paper.get("status", "")
    return status == "queued" or status.startswith("processing_")


def not_cancelled(paper: dict[str, Any]) -> bool:
    return paper.get("status") != CANCELLED


def retryable(paper: dict[str, Any]) -> bool:
    """失敗した解析・中止した解析と、引き継ぎでも動かなかった止まったままの解析（is_stale）を再実行できる。"""
    status = paper.get("status", "")
    if status in ("failed", CANCELLED):
        return True
    return running(paper) and is_stale(paper)


class QuizNotReady(Exception):
    """解析が終わっていない（誤りの元になる Step 2・3 の結果が揃っていない）。"""


class QuizTooSmall(Exception):
    """根拠を照合できた項目が少なく、問題を作れない。"""


class QuizNotAnswered(Exception):
    """今の問題にまだ回答していない（答える前に作り直すと、変わった文から誤りが分かってしまう）。"""


class QuizBusy(Exception):
    """この論文の問題を作っている最中。"""


class QuizNotFound(Exception):
    """問題が無い、または新しい問題に置き換わっている。"""


class QuizAlreadyAnswered(Exception):
    pass


class QuizBadAnswer(Exception):
    pass


class QuizFailed(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class AskFailed(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class PaperService:
    def __init__(
        self,
        analyzers: Mapping[bool, Analyzer] | None = None,
        max_jobs: int = 2,
        starter: Callable[[str], None] | None = None,
        rng: random.Random | None = None,
        heartbeat_sec: float | None = None,
    ):
        self._heartbeat_sec = config.HEARTBEAT_SEC if heartbeat_sec is None else heartbeat_sec
        # キーは論文の demo フラグ
        self.analyzers: Mapping[bool, Analyzer] = analyzers or {True: DemoAnalyzer(), False: GeminiAnalyzer()}
        # 同時に走る解析ジョブ数を制限（Cloud Tasks の同時実行数制限に相当。API のレート制限対策）
        self._job_slots = threading.BoundedSemaphore(max_jobs)
        self._running: set[str] = set()
        self._running_lock = threading.Lock()
        self._starter = starter or self._start_thread
        self.ask_limiter = RateLimiter(config.ASK_RATE_PER_MIN, 60)
        self.retry_limiter = RateLimiter(config.RETRY_RATE_PER_MIN, 60)
        self.quiz_limiter = RateLimiter(config.QUIZ_RATE_PER_MIN, 60)
        self.rng = rng or random.SystemRandom()
        self._quiz_making: set[str] = set()  # 問題を作っている最中の論文（同じ論文の同時の作成で上限を二重に使わない）
        self._quiz_making_lock = threading.Lock()
        # サービス全体の上限（論文を増やしても回避できない）
        self.ask_global_limiter = RateLimiter(config.ASK_GLOBAL_PER_MIN, 60)
        self.upload_quota = DailyQuota("uploads", config.MAX_UPLOADS_PER_DAY, directory=config.QUOTA_DIR)
        self.analysis_quota = DailyQuota("analyses", config.MAX_ANALYSES_PER_DAY, directory=config.QUOTA_DIR)
        self.ask_quota = DailyQuota("asks", config.MAX_ASKS_PER_DAY, directory=config.QUOTA_DIR)
        self.quiz_quota = DailyQuota("quizzes", config.MAX_QUIZZES_PER_DAY, directory=config.QUOTA_DIR)
        self.check = ConceptCheckService(self)  # 確認モード。上限は誤り探しと別に持つ

    # ---------- 材料 ----------

    def analyzer_for(self, paper: Paper) -> Analyzer:
        return self.analyzers[paper.demo]

    def source(self, paper: Paper) -> PaperSource:
        pdf_bytes = store.get_pdf_bytes(paper.id)
        cached = store.load_pages(paper.id)
        if cached is None:  # アップロード時に保存していない古い論文だけ、ここで1回抽出して保存する
            pages = extract_pages(pdf_bytes)
            cached = (pages, [normalize(p) for p in pages])
            store.save_pages(paper.id, *cached)
        return PaperSource(paper=paper, pdf_bytes=pdf_bytes, pages=cached[0], norm_pages=cached[1])

    # ---------- 作成 ----------

    def create(
        self, *, data: bytes, pages: list[str], filename: str, level: str, lang: str = "ja", sha256: str = "", owner: str | None = None
    ) -> tuple[str, bool]:
        """論文の記録を作る。同じ PDF が解析済みなら解析結果（results）だけを写し、再解析しない。

        記録はアップロードごとに新しく作り、ほかの人の論文IDや会話履歴は返さない。
        新しく解析する場合だけ、解析の1日の上限を使う。上限に達していれば、古い版の結果があればそれを写し、無ければ何も保存せず QuotaExceeded。
        """
        existing_id = store.find_by_hash(sha256, level, lang) if sha256 else None
        source = store.load(existing_id) if existing_id else None
        if source is None and not self.analysis_quota.take():
            # 上限に達していても、同じ PDF の古い版の結果があればそれを出す。版を上げた直後に
            # デモ用の論文が上限のエラーになるのを避けるため（新しい項目は出ないが、読める状態を保つ）
            older_id = store.find_by_hash(sha256, level, lang, any_version=True) if sha256 else None
            source = store.load(older_id) if older_id else None
            if source is None:
                raise QuotaExceeded
        paper_id = store.new_id()
        store.save_pdf(paper_id, data)
        store.save_pages(paper_id, pages, [normalize(p) for p in pages])
        store.save(
            {
                "id": paper_id,
                "filename": filename,
                "sha256": sha256,
                "level": level,
                "lang": lang,
                "page_count": len(pages),
                "status": "done" if source else "queued",
                "error": None,
                "demo": source["demo"] if source else config.DEMO_MODE,
                "analysis_version": source.get("analysis_version") if source else config.ANALYSIS_VERSION,
                "results": dict(source["results"]) if source else {},
                "messages": [],
                "owner": owner,
                "created_at": store.now(),
            }
        )
        if source:
            return paper_id, True
        self.start(paper_id)
        return paper_id, False

    # ---------- 解析 ----------

    def start(self, paper_id: str) -> None:
        self._starter(paper_id)

    def _start_thread(self, paper_id: str) -> None:
        threading.Thread(target=self.run_analysis, args=(paper_id,), daemon=True).start()

    def run_analysis(self, paper_id: str) -> None:
        """Step 1 を生成し、続けて Step 2・3 を同時に生成して、終わったものから保存する（画面は届いた順に表示）。

        何度呼んでも同じ結果になる: 解析済みなら何もしない、終わった Step は飛ばす、
        同じ論文の解析がこのプロセスで走っていれば何もしない。
        """
        with self._running_lock:
            if paper_id in self._running:
                log.info("analysis already running paper=%s", paper_id)
                return
            self._running.add(paper_id)
        try:
            with self._job_slots:
                self._analyze(paper_id)
        finally:
            with self._running_lock:
                self._running.discard(paper_id)

    def _analyze(self, paper_id: str) -> None:
        try:
            raw = store.load(paper_id)
            if raw is None:
                log.warning("analysis skipped: paper=%s not found", paper_id)
                return
            paper = Paper.model_validate(raw)
            if paper.status in ("done", CANCELLED):
                return
            src = self.source(paper)
            analyzer = self.analyzer_for(paper)
            results = dict(paper.results)
            # 解析中は heartbeat_at を書き続ける（スレッドが消えたら止まり、別のプロセスが引き継げる）
            with Heartbeat(paper_id, self._heartbeat_sec, running):
                if not results.get("step1"):
                    # 中止されていたら進まない（状態の確認と書き込みを1回の操作で行う）
                    if store.transition(paper_id, not_cancelled, status="processing_step1", heartbeat_at=store.now()) is None:
                        log.info("paper=%s cancelled before step1", paper_id)
                        return
                    log.info("paper=%s step1 start (demo=%s)", paper_id, paper.demo)
                    results = {**results, "step1": finalize_step("step1", analyzer.step1(src), src.norm_pages)}
                    if not self._save_result(paper_id, "step1", results["step1"]):
                        return
                if not self._run_parallel(paper_id, analyzer, src, results):
                    return
            store.transition(paper_id, not_cancelled, status="done", error=None, analysis_version=config.ANALYSIS_VERSION)
        except Exception as e:  # noqa: BLE001
            # 画面には決まった文言だけを返し、詳細は paper_id 付きでログに残す
            log.exception("analysis failed paper=%s", paper_id)
            try:
                # 中止したあとに失敗した場合は「中止」のままにする
                store.transition(paper_id, not_cancelled, status="failed", error=errors.user_message(e))
            except KeyError:
                log.warning("paper=%s disappeared during analysis", paper_id)

    @staticmethod
    def _save_result(paper_id: str, key: str, value: dict[str, Any]) -> bool:
        """結果を保存する。Gemini の呼び出し中に中止されていたら保存せず False（状態の確認と書き込みは1回の操作）。"""
        saved = store.mutate(paper_id, lambda p: None if p.get("status") == CANCELLED else {**p, "results": {**p.get("results", {}), key: value}})
        if saved is None:
            log.info("paper=%s cancelled during %s; result discarded", paper_id, key)
        return saved is not None

    def _run_parallel(self, paper_id: str, analyzer: Analyzer, src: PaperSource, results: dict[str, Any]) -> bool:
        """終わっていない Step 2・3 を同時に生成する。続けられなければ（中止）False。

        Step 2 と Step 3 はどちらも Step 1 の結果だけを使い、互いの結果を使わないので並べて走らせられる。
        画面の status は processing_step2 / processing_step3 の表記を変えず、まだ終わっていない方の Step を示す
        （Step 2 が終われば processing_step3 になる）。片方が失敗してももう片方は最後まで走らせて保存し、
        そのあとで例外を投げる。再実行は結果のない Step だけを作り直す。
        """
        pending = [k for k in ("step2", "step3") if not results.get(k)]
        if not pending:
            return True
        if store.transition(paper_id, not_cancelled, status=f"processing_{pending[0]}") is None:
            log.info("paper=%s cancelled before %s", paper_id, pending[0])
            return False
        lock = threading.Lock()
        remaining = set(pending)

        def work(key: str) -> bool:
            log.info("paper=%s %s start (demo=%s)", paper_id, key, src.paper.demo)
            out = finalize_step(key, _generate_step(analyzer, key, src, results), src.norm_pages)
            if not self._save_result(paper_id, key, out):
                return False
            log.info("paper=%s %s done", paper_id, key)
            with lock:
                remaining.discard(key)
                left = sorted(remaining)
            if left:  # 終わっていない方の Step を画面に示す
                store.transition(paper_id, running, status=f"processing_{left[0]}")
            return True

        with ThreadPoolExecutor(max_workers=len(pending), thread_name_prefix=f"steps-{paper_id}") as pool:
            futures = [pool.submit(work, k) for k in pending]
        # with を抜けた時点で全部終わっている。最初の失敗だけを投げ、2つ目以降はログに残す（失敗の原因を失わない）
        outcomes: list[bool] = []
        first_error: Exception | None = None
        for key, future in zip(pending, futures, strict=True):
            try:
                outcomes.append(future.result())
            except Exception as e:  # noqa: BLE001
                if first_error is None:
                    first_error = e
                else:
                    log.warning("paper=%s %s also failed: %s: %s", paper_id, key, type(e).__name__, e)
        if first_error is not None:
            raise first_error
        return all(outcomes)

    def take_over(self, paper_id: str, now: datetime | None = None) -> dict[str, Any] | None:
        """止まった解析（heartbeat が TAKEOVER_AFTER_SEC より古い queued / processing_*）を引き継いで続きから走らせる。

        引き継いだら更新後の記録を、引き継がなければ None を返す。このプロセスで走っている解析・中止した論文・
        新しい heartbeat のものは引き継がない。状態の確認と書き込みを1回の操作で行うので、同時に呼ばれても1回だけ引き継ぐ。
        同じ解析の続きなので、解析の1日の上限には数えない。上限（MAX_TAKEOVERS）を超えたら failed にして再実行に任せる。
        """
        with self._running_lock:
            if paper_id in self._running:
                return None
        at = now or datetime.now(UTC)
        info: dict[str, Any] = {}

        def decide(p: dict[str, Any]) -> dict[str, Any] | None:
            if not running(p):
                return None
            last = last_alive(p)
            age = float("inf") if last is None else (at - last).total_seconds()
            if age <= config.TAKEOVER_AFTER_SEC:
                return None
            count = int(p.get("takeovers") or 0)
            if count >= config.MAX_TAKEOVERS:
                info["gave_up"] = count
                return {**p, "status": "failed", "error": errors.TAKEN_OVER_TOO_MANY}
            info.update(age=age, attempt=count + 1)
            return {**p, "takeovers": count + 1, "heartbeat_at": at.isoformat()}

        try:
            paper = store.mutate(paper_id, decide)
        except KeyError:
            return None
        if "gave_up" in info:
            log.warning("paper=%s gave up after %d takeovers", paper_id, info["gave_up"])
            return None
        if paper is None:
            return None
        log.info("paper=%s taken over (stale heartbeat %.0fs, attempt %d)", paper_id, info["age"], info["attempt"])
        self.start(paper_id)
        return paper

    def cancel(self, paper_id: str) -> bool:
        """解析待ち・解析中の論文を中止する。中止できない状態（完了・失敗・中止済み）なら False。

        実行中の Gemini の呼び出しは途中で切れないので、状態だけを先に「中止」にする。
        解析の処理は、その呼び出しが返ったところで結果を捨てて終わる。終わった Step の結果は残す。
        """
        if store.transition(paper_id, running, status=CANCELLED, error=None) is None:
            return False
        log.info("paper=%s analysis cancelled by user", paper_id)
        return True

    def retry(self, paper_id: str) -> bool:
        """状態の確認と queued への変更を1回の操作で行い、二度押しで解析が2本走らないようにする。

        再解析も Gemini を呼ぶので、解析の1日の上限を使う。上限に達していれば状態を変えず QuotaExceeded。
        """
        paper = store.load(paper_id)
        if paper is None or not retryable(paper):
            return False
        if not self.analysis_quota.take():
            raise QuotaExceeded
        # 古い版で途中まで作った結果は、今の版のプロンプトで作り直す（古い結果に新しい版を付けない）
        restart = {} if paper.get("analysis_version") == config.ANALYSIS_VERSION else {"results": {}, "analysis_version": config.ANALYSIS_VERSION}
        # 引き継ぎの回数と古い heartbeat を消す（再実行の直後に、古い heartbeat で引き継がれないように）
        restart = {**restart, "takeovers": 0, "heartbeat_at": None}
        if store.transition(paper_id, retryable, status="queued", error=None, **restart) is None:
            return False
        self.start(paper_id)
        return True

    # ---------- Q&A ----------

    def ask(self, paper_id: str, question: str, current_step: int | None) -> list[dict[str, Any]]:
        raw = store.load(paper_id)
        if raw is None:
            raise PaperNotFound(paper_id)
        paper = Paper.model_validate(raw)
        src = self.source(paper)
        try:
            out = self.analyzer_for(paper).ask(src, question, paper.messages, current_step)
        except Exception as e:  # noqa: BLE001
            log.exception("ask failed paper=%s", paper_id)
            raise AskFailed(errors.user_message(e)) from e
        out = verify_all(out, src.norm_pages)
        updated = store.append_messages(
            paper_id,
            {"role": "user", "text": question, "created_at": store.now()},
            {"role": "assistant", "text": out["answer"], **{k: out[k] for k in ("source", "evidence", "confidence")}, "created_at": store.now()},
        )
        return updated["messages"]

    # ---------- 誤り探しモード ----------

    def get_quiz(self, paper_id: str) -> dict[str, Any] | None:
        """保存済みの問題を公開用の形で返す。無ければ None。Gemini は呼ばない。"""
        raw = store.load(paper_id)
        if raw is None:
            raise PaperNotFound(paper_id)
        return quiz.public_view(raw["quiz"]) if raw.get("quiz") else None

    def create_quiz(self, paper_id: str, force: bool = False) -> dict[str, Any]:
        """誤り探しの問題を作って保存する。force でなく問題があれば、それをそのまま返す（上限に数えない）。

        順序: 解析済みか → 既存の問題 → 元にできる文があるか → 論文ごとの回数 → 1日の上限 → Gemini。
        断る場合に上限を使わないよう、費用のかかる確認ほど後ろに置く。
        """
        raw = store.load(paper_id)
        if raw is None:
            raise PaperNotFound(paper_id)
        paper = Paper.model_validate(raw)
        if paper.status != "done" or not paper.results.get("step2") or not paper.results.get("step3"):
            raise QuizNotReady
        existing = raw.get("quiz")
        if existing and not force:
            return quiz.public_view(existing)
        if existing and existing.get("submitted_at") is None:
            raise QuizNotAnswered
        with self._quiz_making_lock:
            if paper_id in self._quiz_making:
                raise QuizBusy
            self._quiz_making.add(paper_id)
        try:
            return self._make_quiz(paper, existing)
        finally:
            with self._quiz_making_lock:
                self._quiz_making.discard(paper_id)

    def _make_quiz(self, paper: Paper, existing: dict[str, Any] | None) -> dict[str, Any]:
        seq = (existing or {}).get("seq", 0) + 1
        # デモモードは問題をいつも同じにする（e2e のため）。回数ごとには変える
        rng = random.Random(seq) if paper.demo else self.rng
        pool = quiz.candidates(paper.results, rng, require_overlap=not paper.demo)
        if len(pool) < quiz.MIN_SENTENCES:
            raise QuizTooSmall
        if not self.quiz_limiter.allow(paper.id):
            raise RateLimited
        if not self.quiz_quota.take():
            raise QuotaExceeded
        picked, n_wrong = quiz.choose(pool, rng)
        wrong_ids = {c["id"] for c in rng.sample(picked, n_wrong)}
        targets = [{"id": c["id"], "text": c["text"], "quote": c["quote"]} for c in picked if c["id"] in wrong_ids]
        rewrites = self._rewrite(paper, targets)
        record = quiz.build(picked, wrong_ids, rewrites, rng, seq, store.now())
        saved: dict[str, Any] = {}

        def put(p: dict[str, Any]) -> dict[str, Any] | None:
            # 読んだときと同じ seq のときだけ書く（compare-and-set）。先に別の要求が保存していたら、そちらを残す
            current = p.get("quiz")
            if current is not None and current.get("seq", 0) != seq - 1:
                saved.update(current)
                return None
            return {**p, "quiz": record}

        store.mutate(paper.id, put)
        return quiz.public_view(saved or record)

    def _rewrite(self, paper: Paper, targets: list[dict[str, Any]]) -> dict[str, dict[str, str]]:
        """書き換えを作らせて検証する。使えない出力は捨てて、もう1回だけ作り直す。"""
        analyzer = self.analyzer_for(paper)
        for attempt in (1, 2):
            try:
                return quiz.validate_rewrites(analyzer.rewrite(paper, targets), targets)
            except (quiz.QuizInvalid, ValidationError, errors.EmptyResponseError) as e:
                log.warning("quiz rewrite rejected paper=%s attempt=%d: %s", paper.id, attempt, type(e).__name__)
            except Exception as e:  # noqa: BLE001
                log.exception("quiz generation failed paper=%s", paper.id)
                raise QuizFailed(errors.user_message(e)) from e
        raise QuizFailed(errors.BAD_RESPONSE)

    def answer_quiz(self, paper_id: str, quiz_id: str, picks: list[QuizPick]) -> dict[str, Any]:
        """回答を採点して保存する。1つの問題には1回しか回答できない（答えを見てからやり直せないように）。"""
        out: dict[str, Any] = {}

        def apply(p: dict[str, Any]) -> dict[str, Any]:
            q = p.get("quiz")
            if not q or q["id"] != quiz_id:
                raise QuizNotFound(quiz_id)
            if q.get("submitted_at") is not None:
                raise QuizAlreadyAnswered(quiz_id)
            ids = [pick.id for pick in picks]
            if len(set(ids)) != len(ids) or not set(ids) <= {i["id"] for i in q["items"]}:
                raise QuizBadAnswer(quiz_id)
            done = {**q, "submitted_at": store.now(), "result": quiz.score(q, picks)}
            out.update(done)
            return {**p, "quiz": done}

        try:
            store.mutate(paper_id, apply)
        except KeyError as e:
            raise PaperNotFound(paper_id) from e
        return quiz.public_view(out)
