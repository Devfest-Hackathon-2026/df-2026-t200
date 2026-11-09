"""解析中の進捗（Step ごとの段階・書いた文字数・開始時刻）。プロセス内の辞書に持ち、lock で守る。

記録（JSON ファイル）には毎回書かない（GCS FUSE の書き込みを増やさないため）。
heartbeat の書き込みのついでに summary() だけを記録の progress に入れ、引き継ぎ後や別のサーバーからの問い合わせでも大まかに出せるようにする。
"""

import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, replace
from typing import Any

READING, WRITING, VERIFYING, DONE = "reading", "writing", "verifying", "done"


@dataclass(frozen=True)
class StepProgress:
    phase: str
    chars: int
    started: float
    ended: float | None = None


class ProgressTracker:
    """論文 id → Step → StepProgress。値は作り直して置き換える（書き換えない）。"""

    def __init__(self, clock: Callable[[], float] = time.monotonic):
        self._clock = clock
        self._lock = threading.Lock()
        self._papers: dict[str, dict[str, StepProgress]] = {}

    def _update(self, paper_id: str, key: str, fn: Callable[[StepProgress], StepProgress], *, create: bool = False) -> None:
        with self._lock:
            steps = self._papers.get(paper_id)
            current = steps.get(key) if steps else None
            if current is None and not create:
                return  # 始まっていない Step への通知は無視する
            base = current or StepProgress(READING, 0, self._clock())
            self._papers[paper_id] = {**(steps or {}), key: fn(base)}

    def begin(self, paper_id: str, key: str) -> None:
        self._update(paper_id, key, lambda _s: StepProgress(READING, 0, self._clock()), create=True)

    def wrote(self, paper_id: str, key: str, chars: int) -> None:
        # 照合に入ったあとに届いた古い通知では、段階を戻さない
        self._update(paper_id, key, lambda s: replace(s, phase=WRITING, chars=chars) if s.phase in (READING, WRITING) else s)

    def verifying(self, paper_id: str, key: str) -> None:
        self._update(paper_id, key, lambda s: replace(s, phase=VERIFYING))

    def finish(self, paper_id: str, key: str) -> None:
        self._update(paper_id, key, lambda s: replace(s, phase=DONE, ended=self._clock()))

    def clear(self, paper_id: str) -> None:
        with self._lock:
            self._papers.pop(paper_id, None)

    def snapshot(self, paper_id: str) -> dict[str, Any] | None:
        """画面に出す形（段階・文字数・経過秒）。終わった Step の経過時間は止まる。"""
        with self._lock:
            steps = self._papers.get(paper_id)
        if not steps:
            return None
        now = self._clock()
        return {k: {"phase": s.phase, "chars": s.chars, "elapsed": round((s.ended or now) - s.started, 1)} for k, s in steps.items()}

    def summary(self, paper_id: str) -> dict[str, Any] | None:
        """記録に入れる要約（段階と文字数だけ）。"""
        snap = self.snapshot(paper_id)
        return {k: {"phase": v["phase"], "chars": v["chars"]} for k, v in snap.items()} if snap else None
