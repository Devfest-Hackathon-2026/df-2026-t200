"""Step 1 の前提知識（concepts）の新しい項目をサーバー側で整える。

importance / category / origin / evidence は後から足した付加情報なので、Gemini の出力が少し外れても
Step 1 全体は失敗させない。使えない項目だけ外し（既定値になる）、概念の名前や説明などの中核項目の不備は従来どおり失敗にする。
"""

from typing import Any

from .schemas import Importance, Origin

_IMPORTANCE = {m.value for m in Importance}
_ORIGIN = {m.value for m in Origin}


def _valid_evidence(v: Any) -> bool:
    return isinstance(v, list) and all(
        isinstance(e, dict) and isinstance(e.get("page"), int) and not isinstance(e.get("page"), bool) and isinstance(e.get("quote"), str) for e in v
    )


def _repair_concept(c: Any) -> Any:
    if not isinstance(c, dict):
        return c
    out = dict(c)
    if out.get("importance") not in _IMPORTANCE:
        out.pop("importance", None)
    if out.get("origin") not in _ORIGIN:
        out.pop("origin", None)
    if not isinstance(out.get("category"), str):
        out.pop("category", None)
    if not _valid_evidence(out.get("evidence")):
        out.pop("evidence", None)
    return out


def repair_step1(raw: Any) -> dict[str, Any] | None:
    """検証に失敗した Step 1 の出力から、概念の付加項目だけを直したコピーを返す。直せる形でなければ None。"""
    if not isinstance(raw, dict) or not isinstance(raw.get("concepts"), list):
        return None
    return {**raw, "concepts": [_repair_concept(c) for c in raw["concepts"]]}


def clean_concepts(step1: dict[str, Any]) -> dict[str, Any]:
    """論文に出てこない概念（ai_inference）には引用を持たせない。引用がないので照合も根拠チップもない。"""
    concepts = [{**c, "evidence": []} if c.get("origin") == "ai_inference" and c.get("evidence") else c for c in step1.get("concepts", [])]
    return {**step1, "concepts": concepts}
