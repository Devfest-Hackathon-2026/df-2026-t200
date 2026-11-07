"""Step 2 の流れ図（flow）をサーバー側で整える。

Gemini が出した flow に不整合があっても解析全体は失敗させず、直せる所は直し、使えなければ flow だけ外す。
図の型はフロントが持つので、ここで扱うのは JSON のデータだけ（コードや HTML は受け取らない）。
"""

import copy
from typing import Any

MAX_NODES = 12


def _dicts(v: Any) -> list[dict[str, Any]]:
    return [x for x in v if isinstance(x, dict)] if isinstance(v, list) else []


def _strs(v: Any, allowed: set[str]) -> list[str]:
    return [x for x in v if isinstance(x, str) and x in allowed] if isinstance(v, list) else []


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
        if a in seen and b in seen and a != b and f"{a}->{b}" not in keys:
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
    return {**flow, "nodes": nodes, "edges": edges, "frames": [frames[i] for i in sorted(frames)]}


def clean_flow(step2: dict[str, Any]) -> dict[str, Any]:
    """Step 2 の結果の flow を整えた新しい dict を返す（元は変更しない）。使えない flow は外す。"""
    out = copy.deepcopy(step2)
    if "flow" not in out:
        return out
    stages = out.get("stages")
    cleaned = _clean(out["flow"], len(stages) if isinstance(stages, list) else 0)
    if cleaned is None:
        del out["flow"]
    else:
        out["flow"] = cleaned
    return out
