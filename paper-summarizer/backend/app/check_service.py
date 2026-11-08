"""確認モードの組み立て。誤り探し（services.PaperService の quiz 系）と同じ作りで、論文の記録の check に保存する。

PaperService の持つ解析器・材料の読み込みを借りる（services を import すると循環するので、必要な形だけを Protocol で受ける）。
"""

import logging
import random
import threading
from typing import Any, Protocol

from pydantic import ValidationError

from . import check, config, errors, store
from .errors import PaperNotFound, QuotaExceeded, RateLimited
from .pdf_utils import verify_all
from .quota import DailyQuota
from .ratelimit import RateLimiter
from .schemas import CheckAnswer, Paper

log = logging.getLogger("paper")


class CheckNotReady(Exception):
    """Step 1（前提知識）がまだできていない。"""


class CheckBadConcepts(Exception):
    """概念の指定が正しくない（空、Step 1 に無い id、6を超える数）。"""


class CheckNotAnswered(Exception):
    """今の問題にまだ回答していない。"""


class CheckBusy(Exception):
    """この論文の問題を作っている最中。"""


class CheckNotFound(Exception):
    """問題が無い、または新しい問題に置き換わっている。"""


class CheckAlreadyAnswered(Exception):
    pass


class CheckBadAnswer(Exception):
    pass


class CheckFailed(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class _Host(Protocol):
    rng: random.Random

    def analyzer_for(self, paper: Paper) -> Any: ...
    def source(self, paper: Paper) -> Any: ...


class ConceptCheckService:
    def __init__(self, host: _Host):
        self._host = host
        self.limiter = RateLimiter(config.CHECK_RATE_PER_MIN, 60)
        self.quota = DailyQuota("checks", config.MAX_CHECKS_PER_DAY, directory=config.QUOTA_DIR)
        self._making: set[str] = set()  # 問題を作っている最中の論文（同じ論文の同時の作成で上限を二重に使わない）
        self._making_lock = threading.Lock()

    def get(self, paper_id: str) -> dict[str, Any] | None:
        """保存済みの問題を公開用の形で返す。無ければ None。Gemini は呼ばない。"""
        raw = store.load(paper_id)
        if raw is None:
            raise PaperNotFound(paper_id)
        return check.public_view(raw["check"]) if raw.get("check") else None

    def create(self, paper_id: str, concept_ids: list[str], force: bool = False) -> dict[str, Any]:
        """指定した概念の確認問題を作って保存する。force でなく問題があれば、それをそのまま返す（上限に数えない）。

        順序: Step 1 があるか → 概念の指定 → 既存の問題 → 論文ごとの回数 → 1日の上限 → Gemini。
        断る場合に上限を使わないよう、費用のかかる確認ほど後ろに置く。
        """
        raw = store.load(paper_id)
        if raw is None:
            raise PaperNotFound(paper_id)
        paper = Paper.model_validate(raw)
        concepts = (paper.results.get("step1") or {}).get("concepts") or []
        if not concepts:
            raise CheckNotReady
        targets = self._targets(concepts, concept_ids)
        existing = raw.get("check")
        if existing and not force:
            return check.public_view(existing)
        if existing and existing.get("submitted_at") is None:
            raise CheckNotAnswered
        with self._making_lock:
            if paper_id in self._making:
                raise CheckBusy
            self._making.add(paper_id)
        try:
            return self._make(paper, targets, existing)
        finally:
            with self._making_lock:
                self._making.discard(paper_id)

    @staticmethod
    def _targets(concepts: list[dict[str, Any]], concept_ids: list[str]) -> list[dict[str, Any]]:
        by_id = {c["id"]: c for c in concepts if isinstance(c, dict) and isinstance(c.get("id"), str)}
        ids = list(dict.fromkeys(concept_ids))  # 重複を除く（順序は保つ）
        if not ids or len(ids) > check.MAX_CONCEPTS or any(i not in by_id for i in ids):
            raise CheckBadConcepts
        return [
            {
                "id": i,
                "name": by_id[i].get("name", ""),
                "description": by_id[i].get("description", ""),
                "why_needed": by_id[i].get("why_needed", ""),
                "origin": by_id[i].get("origin", "paper"),
            }
            for i in ids
        ]

    def _make(self, paper: Paper, targets: list[dict[str, Any]], existing: dict[str, Any] | None) -> dict[str, Any]:
        seq = (existing or {}).get("seq", 0) + 1
        # デモモードは問題をいつも同じにする（e2e のため）。回数ごとには変える
        rng = random.Random(seq) if paper.demo else self._host.rng
        if not self.limiter.allow(paper.id):
            raise RateLimited
        try:
            src = self._host.source(paper)  # PDF の読み込みに失敗したときは、上限を使わない
        except Exception as e:  # noqa: BLE001
            log.exception("check source failed paper=%s", paper.id)
            raise CheckFailed(errors.user_message(e)) from e
        if not self.quota.take():
            raise QuotaExceeded
        questions = self._generate(paper, src, targets)
        # 論文の概念の引用を PDF と照合する（一致しなければ verified=False のまま画面に出る）
        questions = {cid: {**q, "evidence": verify_all(q["evidence"], src.norm_pages) if q["evidence"] else None} for cid, q in questions.items()}
        record = check.build(targets, questions, rng, seq, store.now())
        saved: dict[str, Any] = {}

        def put(p: dict[str, Any]) -> dict[str, Any] | None:
            # 読んだときと同じ seq のときだけ書く（compare-and-set）。先に別の要求が保存していたら、そちらを残す
            current = p.get("check")
            if current is not None and current.get("seq", 0) != seq - 1:
                saved.update(current)
                return None
            return {**p, "check": record}

        store.mutate(paper.id, put)
        return check.public_view(saved or record)

    def _generate(self, paper: Paper, src: Any, targets: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
        """問題を作らせて検証する。使えない出力は捨てて、もう1回だけ作り直す。"""
        analyzer = self._host.analyzer_for(paper)
        for attempt in (1, 2):
            try:
                return check.validate_questions(analyzer.check(src, targets), targets)
            except (check.CheckInvalid, ValidationError, errors.EmptyResponseError) as e:
                log.warning("check generation rejected paper=%s attempt=%d: %s", paper.id, attempt, type(e).__name__)
            except Exception as e:  # noqa: BLE001
                log.exception("check generation failed paper=%s", paper.id)
                raise CheckFailed(errors.user_message(e)) from e
        raise CheckFailed(errors.BAD_RESPONSE)

    def answer(self, paper_id: str, check_id: str, answers: list[CheckAnswer]) -> dict[str, Any]:
        """回答を採点して保存する。1つの問題には1回しか回答できず、全問に答える必要がある。"""
        out: dict[str, Any] = {}

        def apply(p: dict[str, Any]) -> dict[str, Any]:
            c = p.get("check")
            if not c or c["id"] != check_id:
                raise CheckNotFound(check_id)
            if c.get("submitted_at") is not None:
                raise CheckAlreadyAnswered(check_id)
            ids = [a.id for a in answers]
            if len(set(ids)) != len(ids) or set(ids) != {i["id"] for i in c["items"]}:
                raise CheckBadAnswer(check_id)
            done = {**c, "submitted_at": store.now(), "result": check.score(c, answers)}
            out.update(done)
            return {**p, "check": done}

        try:
            store.mutate(paper_id, apply)
        except KeyError as e:
            raise PaperNotFound(paper_id) from e
        return check.public_view(out)
