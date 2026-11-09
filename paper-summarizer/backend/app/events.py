"""解析の進捗を Server-Sent Events で送る（GET /api/papers/{id}/events）。

進捗が変わるたびに status と progress を送り、done / failed / cancelled で最後の1回を送って閉じる。
このプロセスで走っていない解析（別のサーバーが動かしている・引き継ぎ待ち）は、記録の status と progress を数秒ごとに読んで送る。
接続は最長 SSE_MAX_SEC で閉じる（画面が再接続するか、問い合わせに戻る）。同時接続数にも上限があり、超えたら呼び出し側が 429 を返す。
"""

import asyncio
import json
import threading
import time
from collections.abc import AsyncIterator, Callable
from typing import Any

from . import config, store
from .services import PaperService, running

HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


class Slots:
    """同時接続の枠。論文を増やしても、接続数はこの上限を超えない。"""

    def __init__(self, limit: int):
        self._limit = limit
        self._used = 0
        self._lock = threading.Lock()

    def acquire(self) -> bool:
        with self._lock:
            if self._used >= self._limit:
                return False
            self._used += 1
            return True

    def release(self) -> None:
        with self._lock:
            self._used = max(0, self._used - 1)

    def releaser(self) -> Callable[[], None]:
        """1つの接続につき1回だけ枠を返す関数（終了処理が重なっても二重に返さない）。"""
        once = threading.Event()

        def release() -> None:
            if not once.is_set():
                once.set()
                self.release()

        return release


slots = Slots(config.SSE_MAX_CONNECTIONS)


def _frame(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _signature(payload: dict[str, Any]) -> str:
    """送り直すかの判定用。経過時間だけが進んだ場合は変わりない（画面が毎秒進める）。"""
    progress = payload["progress"] or {}
    steps = {k: (v.get("phase"), v.get("chars")) for k, v in progress.items()}
    return json.dumps([payload["status"], steps], sort_keys=True)


def _refresh(service: PaperService, paper_id: str) -> dict[str, Any] | None:
    """記録を読み直す。止まった解析なら GET と同じように引き継ぐ。記録が消えていれば None。"""
    paper = store.load(paper_id)
    if paper is not None and running(paper):
        paper = service.take_over(paper_id) or store.load(paper_id) or paper
    return paper


async def event_stream(service: PaperService, paper_id: str, release: Callable[[], None]) -> AsyncIterator[str]:
    started = last_sent = time.monotonic()
    last_read = float("-inf")
    last_sig: str | None = None
    paper: dict[str, Any] | None = None
    try:
        while True:
            now = time.monotonic()
            if paper is None or now - last_read >= config.SSE_RECORD_SEC:
                paper = await asyncio.to_thread(_refresh, service, paper_id)
                last_read = now
                if paper is None:
                    return
            payload = {"status": paper["status"], "progress": service.progress_of(paper)}
            finished = not running(paper)
            sig = _signature(payload)
            if sig != last_sig or finished:
                yield _frame(payload)
                last_sig, last_sent = sig, now
                if finished:
                    return
            elif now - last_sent >= config.SSE_PING_SEC:
                yield ": ping\n\n"
                last_sent = now
            if now - started >= config.SSE_MAX_SEC:
                return
            await asyncio.sleep(config.SSE_TICK_SEC)
    finally:
        release()
