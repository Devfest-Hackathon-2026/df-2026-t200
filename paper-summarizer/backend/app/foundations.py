"""Step 1 の「先に読むとよい論文」（foundations）をサーバー側で整える。

foundations は付加情報なので、Gemini の出力が外れても Step 1 全体は失敗させない。
壊れた要素だけを外し、残りをここで整形する。リンクの URL は作らない（DOI と arXiv ID は形だけ確かめて返し、
URL への組み立てはフロントが固定のホストに付けて行う）。
"""

import re
from typing import Any

from pydantic import ValidationError

from .schemas import Foundation

MAX_FOUNDATIONS = 5
_MAX_TITLE = 300
_MAX_AUTHORS = 300
_MAX_REASON = 600

_DOI = re.compile(r"10\.\d{4,9}/[^\s<>\"'\\]+")
_ARXIV = re.compile(r"\d{4}\.\d{4,5}(v\d+)?")
_DOI_PREFIX = re.compile(r"^(https?://(dx\.)?doi\.org/|doi:\s*)", re.IGNORECASE)
_ARXIV_PREFIX = re.compile(r"^(https?://arxiv\.org/abs/|arxiv:\s*)", re.IGNORECASE)


def _doi(v: Any) -> str | None:
    if not isinstance(v, str):
        return None
    s = _DOI_PREFIX.sub("", v.strip())
    return s if _DOI.fullmatch(s) else None


def _arxiv(v: Any) -> str | None:
    if not isinstance(v, str):
        return None
    s = _ARXIV_PREFIX.sub("", v.strip())
    return s if _ARXIV.fullmatch(s) else None


def _key(title: str) -> str:
    return " ".join(title.lower().split())


def repair_foundations(raw: Any) -> dict[str, Any] | None:
    """検証に失敗した Step 1 の出力から、foundations の壊れた要素だけを外したコピーを返す。dict でなければ None。"""
    if not isinstance(raw, dict):
        return None
    items = raw.get("foundations")
    if "foundations" not in raw:
        return dict(raw)
    good = []
    if isinstance(items, list):
        for f in items:
            try:
                Foundation.model_validate(f)
            except ValidationError:
                continue
            good.append(f)
    return {**raw, "foundations": good}


def clean_foundations(step1: dict[str, Any]) -> dict[str, Any]:
    """件数を5まで、order で並べ替え（番号は1から振り直す）、title が空・重複のものを捨て、doi と arxiv_id は形が合うものだけ残す。

    元のデータは変えず、新しい dict を返す。
    """
    seen: set[str] = set()
    items: list[dict[str, Any]] = []
    for f in sorted(step1.get("foundations") or [], key=lambda x: x.get("order", 0)):
        title = " ".join((f.get("title") or "").split())[:_MAX_TITLE]
        if not title or _key(title) in seen:
            continue
        seen.add(_key(title))
        items.append(
            {
                **f,
                "title": title,
                "authors": (f.get("authors") or "").strip()[:_MAX_AUTHORS],
                "reason": (f.get("reason") or "").strip()[:_MAX_REASON],
                "doi": _doi(f.get("doi")),
                "arxiv_id": _arxiv(f.get("arxiv_id")),
            }
        )
    return {**step1, "foundations": [{**f, "order": i} for i, f in enumerate(items[:MAX_FOUNDATIONS], start=1)]}
