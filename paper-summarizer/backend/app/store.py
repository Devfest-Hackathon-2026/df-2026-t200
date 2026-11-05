"""ローカル用の保存層。本番では PDF は Cloud Storage、状態と結果は Firestore に置き換える。

papers/{id}.json に1論文分の状態・結果・会話履歴をまとめて保存する。
uploads/{id}.pdf に PDF 本体、uploads/{id}.pages.json に抽出・正規化済みのページを置く。
"""

import json
import logging
import threading
import uuid
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .config import PAPER_DIR, UPLOAD_DIR

log = logging.getLogger("paper")

# プロセス内の更新をすべて直列にする（1論文=1ファイルなので、全体で1つのロックでも十分）
_lock = threading.Lock()


def now() -> str:
    return datetime.now(UTC).isoformat()


def new_id() -> str:
    return uuid.uuid4().hex[:16]


def pdf_path(paper_id: str) -> Path:
    return UPLOAD_DIR / f"{paper_id}.pdf"


def pages_path(paper_id: str) -> Path:
    return UPLOAD_DIR / f"{paper_id}.pages.json"


def _json_path(paper_id: str) -> Path:
    return PAPER_DIR / f"{paper_id}.json"


def valid_id(paper_id: str) -> bool:
    return len(paper_id) == 16 and all(c in "0123456789abcdef" for c in paper_id)


# ---------- PDF ----------


def save_pdf(paper_id: str, data: bytes) -> None:
    pdf_path(paper_id).write_bytes(data)


def get_pdf_bytes(paper_id: str) -> bytes:
    return pdf_path(paper_id).read_bytes()


def pdf_url(paper_id: str) -> str | None:
    """PDF を直接取りに行ける URL。ローカルでは None（API が本体を返す）。Cloud Storage では署名付き URL を返す。"""
    return None


def save_pages(paper_id: str, pages: list[str], norm_pages: list[str]) -> None:
    pages_path(paper_id).write_text(json.dumps({"pages": pages, "norm_pages": norm_pages}, ensure_ascii=False), encoding="utf-8")


def load_pages(paper_id: str) -> tuple[list[str], list[str]] | None:
    """保存済みのページ（抽出したまま / 照合用に正規化済み）。無い・壊れているときは None。"""
    path = pages_path(paper_id)
    if not path.exists():
        return None
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
        return list(doc["pages"]), list(doc["norm_pages"])
    except (ValueError, KeyError, TypeError):
        log.warning("ignoring corrupt page cache paper=%s", paper_id)
        return None


# ---------- 論文の記録 ----------


def _read(paper_id: str) -> dict[str, Any] | None:
    path = _json_path(paper_id)
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _write(paper: dict[str, Any]) -> dict[str, Any]:
    doc = {**paper, "updated_at": now()}  # 呼び出し元の dict は書き換えない
    path = _json_path(doc["id"])
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)
    return doc


def load(paper_id: str) -> dict[str, Any] | None:
    with _lock:
        return _read(paper_id)


def save(paper: dict[str, Any]) -> dict[str, Any]:
    with _lock:
        return _write(paper)


def mutate(paper_id: str, fn: Callable[[dict[str, Any]], dict[str, Any] | None]) -> dict[str, Any] | None:
    """読み込み → 変更 → 保存を1つのロックの中で行う（Firestore のトランザクションに相当）。

    fn は現在の内容を受け取り、新しい内容を返す。None を返したら保存せず None を返す。
    """
    with _lock:
        paper = _read(paper_id)
        if paper is None:
            raise KeyError(paper_id)
        new = fn(paper)
        if new is None:
            return None
        return _write(new)


def update(paper_id: str, **fields: Any) -> dict[str, Any]:
    return mutate(paper_id, lambda p: {**p, **fields})  # type: ignore[return-value]


def set_result(paper_id: str, key: str, value: Any) -> dict[str, Any]:
    """解析結果を1つだけ書く。ほかの Step の結果や会話は、その時点の最新の内容を残す。"""
    return mutate(paper_id, lambda p: {**p, "results": {**p.get("results", {}), key: value}})  # type: ignore[return-value]


def append_messages(paper_id: str, *messages: dict[str, Any]) -> dict[str, Any]:
    """会話を末尾に追加する。並行して追加しても、渡した組はまとめて連続して入る。"""
    return mutate(paper_id, lambda p: {**p, "messages": [*p.get("messages", []), *messages]})  # type: ignore[return-value]


def transition(paper_id: str, allowed: Callable[[dict[str, Any]], bool], **fields: Any) -> dict[str, Any] | None:
    """allowed(現在の内容) が真のときだけ fields を書く（compare-and-set）。書かなければ None。"""
    return mutate(paper_id, lambda p: {**p, **fields} if allowed(p) else None)


def _iter_papers() -> Iterator[dict[str, Any]]:
    """保存済みの論文を順に返す。壊れた JSON や必須項目のないファイルは飛ばしてログに残す（一覧全体を 500 にしない）。"""
    for path in PAPER_DIR.glob("*.json"):
        try:
            p = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(p, dict) or not all(k in p for k in ("id", "filename", "status", "created_at")):
                raise ValueError("missing required fields")
        except (OSError, ValueError) as e:
            log.warning("skipping corrupt paper file %s: %s", path.name, e)
            continue
        yield p


def list_papers() -> list[dict[str, Any]]:
    items = [
        {
            "id": p["id"],
            "filename": p["filename"],
            "title": (p.get("results", {}).get("step1") or {}).get("title"),
            "status": p["status"],
            "created_at": p["created_at"],
        }
        for p in _iter_papers()
    ]
    return sorted(items, key=lambda x: x["created_at"], reverse=True)


def find_by_hash(sha256: str, level: str) -> str | None:
    for p in _iter_papers():
        if p.get("sha256") == sha256 and p.get("level") == level and p.get("status") == "done":
            return p["id"]
    return None
