"""Step 1 の前提知識（concepts）の新しい項目をサーバー側で整える。

importance / category / origin / evidence は後から足した付加情報なので、Gemini の出力が少し外れても
Step 1 全体は失敗させない。使えない項目だけ外し（既定値になる）、概念の名前や説明などの中核項目の不備は従来どおり失敗にする。
"""

import copy
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


MAX_INFERENCE_DEPTH = 2  # 論文の概念から depends_on をたどって、論文に出てこない前提を何段まで残すか


def _too_deep(concepts: list[dict[str, Any]]) -> set[str]:
    """論文の概念（origin が ai_inference でないもの）から depends_on をたどり、最短で3段目以降になる概念の id。

    幅優先で最短の段数を求めるので、循環があっても止まる。論文の概念から届かない概念は数えない。
    """
    by_id = {c["id"]: c for c in concepts if isinstance(c.get("id"), str)}
    depth = {i: 0 for i, c in by_id.items() if c.get("origin") != "ai_inference"}
    queue = list(depth)
    while queue:
        cur = queue.pop(0)
        for d in by_id[cur].get("depends_on") or []:
            if d in by_id and d not in depth:
                depth[d] = depth[cur] + 1
                queue.append(d)
    return {i for i, n in depth.items() if n > MAX_INFERENCE_DEPTH}


def clean_concepts(step1: dict[str, Any]) -> dict[str, Any]:
    """前提知識を整える。元のデータは変えず、新しい dict を返す。

    - 論文に出てこない概念（ai_inference）には引用を持たせない。引用がないので照合も根拠チップもない
    - ai_inference は、論文の概念から数えて2段までに限る。3段目以降は外し、それへの依存も消す
    """
    concepts = [{**c, "evidence": []} if c.get("origin") == "ai_inference" and c.get("evidence") else c for c in step1.get("concepts", [])]
    drop = _too_deep(concepts)
    if drop:
        concepts = [{**c, "depends_on": [d for d in c.get("depends_on") or [] if d not in drop]} for c in concepts if c.get("id") not in drop]
    return {**step1, "concepts": concepts}


def _each_equation(step2: dict[str, Any]):
    """Step 2 の全段階の式（dict）を順に返す。形が違うものは飛ばす。"""
    stages = step2.get("stages")
    for st in stages if isinstance(stages, list) else []:
        eqs = st.get("equations") if isinstance(st, dict) else None
        for e in eqs if isinstance(eqs, list) else []:
            if isinstance(e, dict):
                yield e


def repair_equation_concepts(raw: Any) -> Any:
    """検証に失敗した Step 2 の出力から、式の concepts だけを直したコピーを返す（文字列でない要素は捨て、配列でなければ外す）。"""
    if not isinstance(raw, dict) or not isinstance(raw.get("stages"), list):
        return raw
    out = copy.deepcopy(raw)
    for e in _each_equation(out):
        if "concepts" not in e:
            continue
        v = e["concepts"]
        if isinstance(v, list):
            e["concepts"] = [x for x in v if isinstance(x, str)]
        else:
            del e["concepts"]
    return out


def clean_equation_concepts(step2: dict[str, Any], valid_ids: set[str]) -> dict[str, Any]:
    """式の concepts から、Step 1 に無い id と重複を捨てる。元のデータは変えず、新しい dict を返す。"""
    out = copy.deepcopy(step2)
    for e in _each_equation(out):
        e["concepts"] = list(dict.fromkeys(c for c in e.get("concepts") or [] if c in valid_ids))
    return out
