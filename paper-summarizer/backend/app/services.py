"""解析と Q&A の組み立て。HTTP の扱い（main.py）と、生成（解析器）・保存（store）をつなぐ。

解析器は Gemini 版とデモ版を同じ形で差し替えられる。論文ごとの demo フラグで選ぶので、
デモモードで作った論文はあとから認証情報を設定してもデモのまま答える（逆も同じ）。
run_analysis(paper_id) は何度呼ばれても同じ結果になる（Cloud Tasks の再試行で呼ばれる前提）。
"""

import logging
import random
import threading
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from types import ModuleType
from typing import Any, Protocol

from pydantic import ValidationError

from . import config, errors, mock, quiz, store
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


def _generate_step(analyzer: Analyzer, key: str, src: PaperSource, results: dict[str, Any]) -> dict[str, Any]:
    if key == "step1":
        return analyzer.step1(src)
    if key == "step2":
        return analyzer.step2(src, results["step1"])
    return analyzer.step3(src, results["step1"])


def is_stale(paper: dict[str, Any]) -> bool:
    stamp = paper.get("updated_at") or paper.get("created_at")
    try:
        last = datetime.fromisoformat(stamp)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return True
    return (datetime.now(UTC) - last).total_seconds() > config.STALE_AFTER_SEC


def retryable(paper: dict[str, Any]) -> bool:
    """失敗した解析と、サーバー停止などで止まったままの解析（一定時間更新なし）を再実行できる。"""
    status = paper.get("status", "")
    if status == "failed":
        return True
    return (status == "queued" or status.startswith("processing_")) and is_stale(paper)


class QuotaExceeded(Exception):
    """サービス全体の1日の上限に達した。"""


class PaperNotFound(Exception):
    """処理の途中で論文の記録が消えた。"""


class RateLimited(Exception):
    """論文ごとの1分あたりの回数制限に達した。"""


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
    ):
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
        self._rng = rng or random.SystemRandom()
        self._quiz_making: set[str] = set()  # 問題を作っている最中の論文（同じ論文の同時の作成で上限を二重に使わない）
        self._quiz_making_lock = threading.Lock()
        # サービス全体の上限（論文を増やしても回避できない）
        self.ask_global_limiter = RateLimiter(config.ASK_GLOBAL_PER_MIN, 60)
        self.upload_quota = DailyQuota("uploads", config.MAX_UPLOADS_PER_DAY, directory=config.QUOTA_DIR)
        self.analysis_quota = DailyQuota("analyses", config.MAX_ANALYSES_PER_DAY, directory=config.QUOTA_DIR)
        self.ask_quota = DailyQuota("asks", config.MAX_ASKS_PER_DAY, directory=config.QUOTA_DIR)
        self.quiz_quota = DailyQuota("quizzes", config.MAX_QUIZZES_PER_DAY, directory=config.QUOTA_DIR)

    # ---------- 材料 ----------

    def analyzer_for(self, paper: Paper) -> Analyzer:
        return self.analyzers[paper.demo]

    def _source(self, paper: Paper) -> PaperSource:
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
        新しく解析する場合だけ、解析の1日の上限を使う。上限に達していれば何も保存せず QuotaExceeded。
        """
        existing_id = store.find_by_hash(sha256, level, lang) if sha256 else None
        source = store.load(existing_id) if existing_id else None
        if source is None and not self.analysis_quota.take():
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
        """Step 1 → 2 → 3 を順に生成し、終わったものから保存する（画面は届いた順に表示）。

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
            if paper.status == "done":
                return
            src = self._source(paper)
            analyzer = self.analyzer_for(paper)
            results = dict(paper.results)
            for key in STEP_KEYS:
                if results.get(key):
                    continue
                store.update(paper_id, status=f"processing_{key}")
                log.info("paper=%s %s start (demo=%s)", paper_id, key, paper.demo)
                results[key] = verify_all(_generate_step(analyzer, key, src, results), src.norm_pages)
                store.set_result(paper_id, key, results[key])
                log.info("paper=%s %s done", paper_id, key)
            store.update(paper_id, status="done", error=None)
        except Exception as e:  # noqa: BLE001
            # 画面には決まった文言だけを返し、詳細は paper_id 付きでログに残す
            log.exception("analysis failed paper=%s", paper_id)
            try:
                store.update(paper_id, status="failed", error=errors.user_message(e))
            except KeyError:
                log.warning("paper=%s disappeared during analysis", paper_id)

    def retry(self, paper_id: str) -> bool:
        """状態の確認と queued への変更を1回の操作で行い、二度押しで解析が2本走らないようにする。

        再解析も Gemini を呼ぶので、解析の1日の上限を使う。上限に達していれば状態を変えず QuotaExceeded。
        """
        paper = store.load(paper_id)
        if paper is None or not retryable(paper):
            return False
        if not self.analysis_quota.take():
            raise QuotaExceeded
        if store.transition(paper_id, retryable, status="queued", error=None) is None:
            return False
        self.start(paper_id)
        return True

    # ---------- Q&A ----------

    def ask(self, paper_id: str, question: str, current_step: int | None) -> list[dict[str, Any]]:
        raw = store.load(paper_id)
        if raw is None:
            raise PaperNotFound(paper_id)
        paper = Paper.model_validate(raw)
        src = self._source(paper)
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
        rng = random.Random(seq) if paper.demo else self._rng
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
