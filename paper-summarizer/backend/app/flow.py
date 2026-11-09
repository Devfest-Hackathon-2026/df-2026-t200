"""Step 2 の流れ図（flow）をサーバー側で整える。

Gemini が出した flow に不整合があっても解析全体は失敗させず、直せる所は直し、使えなければ flow だけ外す。
図の型はフロントが持つので、ここで扱うのは JSON のデータだけ（コードや HTML は受け取らない）。
"""

import copy
import logging
from typing import Any

MAX_NODES = 12
MAX_EDGES = 30
MAX_GROUPS = 4  # 段階（group）の種類の上限
MAX_GROUP_LEN = 20  # 段階の名前の長さの上限（帯のラベルに収まる長さ）

log = logging.getLogger("paper")


def _dicts(v: Any) -> list[dict[str, Any]]:
    return [x for x in v if isinstance(x, dict)] if isinstance(v, list) else []


def _strs(v: Any, allowed: set[str]) -> list[str]:
    return [x for x in v if isinstance(x, str) and x in allowed] if isinstance(v, list) else []


def _group(v: Any) -> str | None:
    """段階の名前を整える。文字列でない・空なら None。空白はひとつにまとめ、長すぎれば切る。"""
    if not isinstance(v, str):
        return None
    name = " ".join(v.split())[:MAX_GROUP_LEN].rstrip()
    return name or None


def _with_groups(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """group を整える（元の dict は変えない）。種類は先に出たものから MAX_GROUPS 個まで、超える分は None にする。
    group の項目を持たない古い結果のノードは、項目を足さずそのまま返す。"""
    kinds: list[str] = []
    out = []
    for n in nodes:
        if "group" not in n:
            out.append(n)
            continue
        g = _group(n["group"])
        if g is not None and g not in kinds:
            if len(kinds) < MAX_GROUPS:
                kinds.append(g)
            else:
                g = None
        out.append({**n, "group": g})
    return out


def repair_flow_groups(raw: Any) -> Any:
    """検証に失敗した Step 2 の出力から、ノードの group だけを直したコピーを返す（文字列でなければ None にする）。"""
    flow = raw.get("flow") if isinstance(raw, dict) else None
    if not isinstance(flow, dict) or not isinstance(flow.get("nodes"), list):
        return raw
    nodes = [
        {**n, "group": n["group"] if isinstance(n["group"], str) else None} if isinstance(n, dict) and "group" in n else n for n in flow["nodes"]
    ]
    return {**raw, "flow": {**flow, "nodes": nodes}}


def _clean(flow: Any, n_stages: int) -> dict[str, Any] | None:
    if not isinstance(flow, dict) or n_stages < 1:
        return None
    nodes: list[dict[str, Any]] = []
    seen: set[str] = set()
    for n in _dicts(flow.get("nodes")):
        nid = n.get("id")
        if isinstance(nid, str) and nid and nid not in seen and len(nodes) < MAX_NODES:
            seen.add(nid)
            nodes.append(n)
    edges: list[dict[str, Any]] = []
    keys: set[str] = set()
    for e in _dicts(flow.get("edges")):
        a, b = e.get("from"), e.get("to")
        if isinstance(a, str) and isinstance(b, str) and a in seen and b in seen and a != b and len(edges) < MAX_EDGES and f"{a}->{b}" not in keys:
            keys.add(f"{a}->{b}")
            edges.append(e)
    frames: dict[int, dict[str, Any]] = {}
    for f in _dicts(flow.get("frames")):
        idx = f.get("stage_index")
        if not isinstance(idx, int) or isinstance(idx, bool):
            continue
        idx = min(max(idx, 0), n_stages - 1)
        if idx in frames:
            continue
        frames[idx] = {
            **f,
            "stage_index": idx,
            "active_nodes": _strs(f.get("active_nodes"), seen),
            "active_edges": _strs(f.get("active_edges"), keys),
        }
    if len(nodes) < 2 or not frames:
        return None
    return {**flow, "nodes": _with_groups(nodes), "edges": edges, "frames": [frames[i] for i in sorted(frames)]}


def clean_flow(step2: dict[str, Any]) -> dict[str, Any]:
    """Step 2 の結果の flow を整えた新しい dict を返す（元は変更しない）。使えない flow は外す。"""
    out = copy.deepcopy(step2)
    if "flow" not in out:
        return out
    stages = out.get("stages")
    cleaned = _clean(out["flow"], len(stages) if isinstance(stages, list) else 0)
    if cleaned is None:
        if out["flow"] is not None:
            log.warning("flow omitted: unusable (stages=%s)", len(stages) if isinstance(stages, list) else "invalid")
        del out["flow"]
    else:
        out["flow"] = cleaned
    return out
