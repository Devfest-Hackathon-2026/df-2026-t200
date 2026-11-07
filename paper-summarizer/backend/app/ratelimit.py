"""プロセス内の簡易レート制限（スライディングウィンドウ）。

Cloud Run で複数インスタンスにすると数がインスタンスごとになるので、本番では Firestore か
Cloud Armor のレート制限に置き換える。
"""

import threading
import time
from collections import deque
from collections.abc import Callable


class RateLimiter:
    def __init__(self, limit: int, window_sec: float = 60.0, clock: Callable[[], float] = time.monotonic):
        self.limit = limit
        self.window_sec = window_sec
        self._clock = clock
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()
        self._last_sweep = clock()

    def _sweep(self, now: float) -> None:
        """窓より古い記録しか残っていないキーを消す（使われなくなった論文の記録を持ち続けない）。"""
        if now - self._last_sweep < self.window_sec:
            return
        self._last_sweep = now
        for key in [k for k, hits in self._hits.items() if not hits or now - hits[-1] >= self.window_sec]:
            del self._hits[key]

    def allow(self, key: str) -> bool:
        """key の直近 window_sec 秒の回数が limit 未満なら記録して True、超えていれば False。"""
        now = self._clock()
        with self._lock:
            self._sweep(now)
            hits = self._hits.setdefault(key, deque())
            while hits and now - hits[0] >= self.window_sec:
                hits.popleft()
            if len(hits) >= self.limit:
                return False
            hits.append(now)
            return True
