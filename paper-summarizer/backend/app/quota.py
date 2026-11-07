"""サービス全体の1日あたりの上限（Gemini の費用の上限）。

認証がないので、論文ごとの回数制限は論文を増やせば回避できる。そこで全体の回数を数え、上限を超えたら断る。
回数は DATA_DIR（本番では Cloud Storage のバケット）にファイルで残し、インスタンスが入れ替わっても0に戻らないようにする。
インスタンスは1台に固定しているので、プロセス内のロックで足りる。上限を 0 にすると、その操作を止められる（緊急停止）。
"""

import json
import logging
import threading
import time
from collections.abc import Callable
from pathlib import Path

log = logging.getLogger("paper")

DAY_SEC = 24 * 60 * 60


class DailyQuota:
    def __init__(
        self,
        name: str,
        limit: int,
        *,
        directory: Path,
        window_sec: float = DAY_SEC,
        clock: Callable[[], float] = time.time,
    ):
        self.name = name
        self.limit = limit
        self.window_sec = window_sec
        self._path = Path(directory) / f"{name}.json"
        self._clock = clock
        self._lock = threading.Lock()

    def _load(self) -> list[float]:
        """記録を読む。まだ無ければ空。中身が壊れていれば警告して空から数え直す。

        読み込み自体の失敗（Cloud Storage の一時的なエラーなど）は OSError のまま投げる。
        ここで空を返して上書きすると数が0に戻り、上限が外れてしまうため。
        """
        try:
            text = self._path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return []
        try:
            data = json.loads(text)
            return [float(t) for t in data] if isinstance(data, list) else []
        except (ValueError, TypeError) as e:
            log.warning("quota file %s is broken, starting over: %s", self._path.name, e)
            return []

    def _save(self, stamps: list[float]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._path.with_suffix(".tmp")
        tmp.write_text(json.dumps(stamps), encoding="utf-8")
        tmp.replace(self._path)

    def take(self) -> bool:
        """直近 window_sec 秒の回数が上限未満なら1回分を記録して True。上限に達していれば False。"""
        if self.limit <= 0:
            return False
        now = self._clock()
        with self._lock:
            try:
                stamps = [t for t in self._load() if now - t < self.window_sec]
                if len(stamps) >= self.limit:
                    log.warning("daily quota reached: %s (%d)", self.name, self.limit)
                    return False
                stamps.append(now)
                self._save(stamps)
                return True
            except OSError as e:
                # 数えられないときは費用を出さない側に倒す
                log.error("quota %s could not be read or written, refusing: %s", self.name, e)
                return False
