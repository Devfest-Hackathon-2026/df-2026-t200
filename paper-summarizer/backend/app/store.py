"""ローカル用の保存層。本番では PDF は Cloud Storage、状態と結果は Firestore に置き換える。

papers/{id}.json に1論文分の状態・結果・会話履歴をまとめて保存する。
"""

import json
import threading
import uuid
from datetime import datetime, timezone
from typing import Any

from .config import PAPER_DIR, UPLOAD_DIR

_lock = threading.Lock()


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return uuid.uuid4().hex[:16]


def pdf_path(paper_id: str):
    return UPLOAD_DIR / f"{paper_id}.pdf"


def _json_path(paper_id: str):
    return PAPER_DIR / f"{paper_id}.json"


def valid_id(paper_id: str) -> bool:
    return len(paper_id) == 16 and all(c in "0123456789abcdef" for c in paper_id)


def save_pdf(paper_id: str, data: bytes) -> None:
    pdf_path(paper_id).write_bytes(data)


def load(paper_id: str) -> dict[str, Any] | None:
    path = _json_path(paper_id)
    if not path.exists():
        return None
    with _lock:
        return json.loads(path.read_text(encoding="utf-8"))


def save(paper: dict[str, Any]) -> None:
    paper["updated_at"] = now()
    path = _json_path(paper["id"])
    tmp = path.with_suffix(".tmp")
    with _lock:
        tmp.write_text(json.dumps(paper, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(path)


def update(paper_id: str, **fields: Any) -> dict[str, Any]:
    paper = load(paper_id)
    if paper is None:
        raise KeyError(paper_id)
    paper.update(fields)
    save(paper)
    return paper


def list_papers() -> list[dict[str, Any]]:
    items = []
    for path in PAPER_DIR.glob("*.json"):
        p = json.loads(path.read_text(encoding="utf-8"))
        items.append(
            {
                "id": p["id"],
                "filename": p["filename"],
                "title": (p.get("results", {}).get("step1") or {}).get("title"),
                "status": p["status"],
                "created_at": p["created_at"],
            }
        )
    return sorted(items, key=lambda x: x["created_at"], reverse=True)


def find_by_hash(sha256: str, level: str) -> str | None:
    for path in PAPER_DIR.glob("*.json"):
        p = json.loads(path.read_text(encoding="utf-8"))
        if p.get("sha256") == sha256 and p.get("level") == level and p.get("status") == "done":
            return p["id"]
    return None
