"""解析中の記録に heartbeat_at を定期的に書く。Gemini の呼び出し中（スレッドが返らない間）も書き続けるため、別の小さなスレッドで動かす。

解析のスレッドごと消えたとき（Cloud Run のインスタンスの入れ替えなど）は、heartbeat_at が止まることで別のプロセスが気づく。
"""

import logging
import threading
from collections.abc import Callable
from typing import Any

from . import store

log = logging.getLogger("paper")


class Heartbeat:
    """with ブロックの間だけ、interval 秒ごとに heartbeat_at を書く。alive(記録) が偽なら書かない（中止・完了・失敗のあとに触らない）。"""

    def __init__(
        self,
        paper_id: str,
        interval: float,
        alive: Callable[[dict[str, Any]], bool],
        extra: Callable[[], dict[str, Any]] | None = None,
    ):
        # extra は、heartbeat_at と同じ書き込みに載せる追加の項目（進捗の要約）。書き込みを増やさないための相乗り
        self._extra = extra
        self._paper_id = paper_id
        self._interval = interval
        self._alive = alive
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._loop, name=f"heartbeat-{paper_id}", daemon=True)

    def beat(self) -> bool:
        """1回書く。記録が消えている・もう動いていない状態なら False。"""
        extra = self._extra() if self._extra else {}
        try:
            return store.mutate(self._paper_id, lambda p: {**p, "heartbeat_at": store.now(), **extra} if self._alive(p) else None) is not None
        except KeyError:
            return False

    def _loop(self) -> None:
        while not self._stop.wait(self._interval):
            try:
                if not self.beat():
                    return
            except Exception:  # noqa: BLE001
                log.exception("heartbeat failed paper=%s", self._paper_id)  # 書き込みの失敗で解析は止めない

    def __enter__(self) -> "Heartbeat":
        self._thread.start()
        return self

    def __exit__(self, *_exc: object) -> None:
        self._stop.set()
        self._thread.join(timeout=5)
