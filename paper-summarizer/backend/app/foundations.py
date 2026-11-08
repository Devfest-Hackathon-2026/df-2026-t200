"""Step 1 の「先に読むとよい論文」（foundations）をサーバー側で整える。

foundations は付加情報なので、Gemini の出力が外れても Step 1 全体は失敗させない。
壊れた要素だけを外し、残りをここで整形する。リンクの URL は作らない（DOI と arXiv ID は形だけ確かめて返し、
URL への組み立てはフロントが固定のホストに付けて行う）。
"""

import re
from typing import Any

from pydantic import ValidationError

from .pdf_utils import normalize
from .schemas import Foundation

MAX_FOUNDATIONS = 5
_MAX_TITLE = 300
_MAX_AUTHORS = 300
_MAX_REASON = 600

_DOI = re.compile(r"10\.[0-9]{4,9}/[^\s<>\"'\\]+")  # \d は全角数字にも一致するので [0-9] を使う
_ARXIV = re.compile(r"[0-9]{4}\.[0-9]{5}(v[0-9]+)?|[0-9]{4}\.[0-9]{4}(v[0-9]+)?")
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


def _compact(text: str) -> str:
    """照合用に正規化し、空白もすべて除く（行をまたいで分かれた DOI でも一致させる）。"""
    return normalize(text).replace(" ", "")


def check_foundations(step1: dict[str, Any], norm_pages: list[str]) -> dict[str, Any]:
    """verify_all の後に呼ぶ。参考文献に載っている論文だけに絞る（プロンプトだけに頼らない）。

    - 根拠が1件も照合に通らない論文は外し、order を 1 から振り直す
    - doi と arxiv_id は、PDF の本文にその文字列が現れないときは null にする
    元のデータは変えず、新しい dict を返す。
    """
    body = "".join(p.replace(" ", "") for p in norm_pages)
    kept = []
    for f in step1.get("foundations") or []:
        if not any(e.get("verified") is True for e in f.get("evidence") or []):
            continue
        doi, arxiv = f.get("doi"), f.get("arxiv_id")
        kept.append(
            {
                **f,
                "doi": doi if doi and _compact(doi) in body else None,
                "arxiv_id": arxiv if arxiv and _compact(arxiv) in body else None,
            }
        )
    return {**step1, "foundations": [{**f, "order": i} for i, f in enumerate(kept, start=1)]}
