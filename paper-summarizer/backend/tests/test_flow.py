"""Step 2 の流れ図（flow）の整形・照合のテスト。"""

import copy

import pytest

from app import flow as flow_mod
from app import mock
from app.pdf_utils import normalize, verify_all
from app.schemas import Step2

PAGES = ["This is the first page of a sample paper about attention and reading support. " * 3, "Second page text with results. " * 5]


def _node(i, kind="process", shape=None):
    return {"id": i, "label": i.upper(), "kind": kind, "shape": shape, "evidence": []}


def _s2(flow, n_stages=3):
    return {"overview": "o", "stages": [{"title": str(k)} for k in range(n_stages)], "flow": flow}


def _flow():
    return {
        "nodes": [_node("a", "input"), _node("b"), _node("c", "output")],
        "edges": [{"from": "a", "to": "b", "label": "x"}, {"from": "b", "to": "c", "label": ""}],
        "frames": [
            {"stage_index": 0, "active_nodes": ["a"], "active_edges": [], "caption": "c0", "evidence": []},
            {"stage_index": 1, "active_nodes": ["b"], "active_edges": ["a->b"], "caption": "c1", "evidence": []},
            {"stage_index": 2, "active_nodes": ["c"], "active_edges": ["b->c"], "caption": "c2", "evidence": []},
        ],
    }


def test_valid_flow_is_kept_unchanged():
    out = flow_mod.clean_flow(_s2(_flow()))
    assert out["flow"] == _flow()


def test_step2_without_flow_is_untouched():
    s2 = {"overview": "o", "stages": [{"title": "x"}]}
    assert flow_mod.clean_flow(s2) == s2
    assert "flow" not in flow_mod.clean_flow({**s2, "flow": None})


def test_unknown_node_ids_are_dropped_from_edges_and_frames():
    f = _flow()
    f["edges"].append({"from": "a", "to": "ghost", "label": ""})
    f["edges"].append({"from": "ghost", "to": "b", "label": ""})
    f["frames"][1]["active_nodes"] = ["b", "ghost"]
    f["frames"][1]["active_edges"] = ["a->b", "a->ghost", "b->a"]
    out = flow_mod.clean_flow(_s2(f))["flow"]
    assert [(e["from"], e["to"]) for e in out["edges"]] == [("a", "b"), ("b", "c")]
    assert out["frames"][1]["active_nodes"] == ["b"]
    assert out["frames"][1]["active_edges"] == ["a->b"]


def test_stage_index_is_clamped_and_one_frame_per_stage():
    f = _flow()
    f["frames"][2]["stage_index"] = 99
    f["frames"][0]["stage_index"] = -4
    f["frames"].append({"stage_index": 1, "active_nodes": ["a"], "active_edges": [], "caption": "dup", "evidence": []})
    out = flow_mod.clean_flow(_s2(f))["flow"]
    assert [fr["stage_index"] for fr in out["frames"]] == [0, 1, 2]
    assert out["frames"][1]["caption"] == "c1"  # 先に出たコマを残す


def test_duplicate_nodes_self_loops_duplicate_edges_removed():
    f = _flow()
    f["nodes"].append(_node("a"))
    f["edges"] += [{"from": "a", "to": "a", "label": ""}, {"from": "a", "to": "b", "label": "again"}]
    out = flow_mod.clean_flow(_s2(f))["flow"]
    assert [n["id"] for n in out["nodes"]] == ["a", "b", "c"]
    assert len(out["edges"]) == 2


def test_node_count_is_capped():
    f = {
        "nodes": [_node(f"n{k}") for k in range(20)],
        "edges": [{"from": "n0", "to": "n19", "label": ""}, {"from": "n0", "to": "n1", "label": ""}],
        "frames": [{"stage_index": 0, "active_nodes": ["n19", "n2"], "active_edges": [], "caption": "c", "evidence": []}],
    }
    out = flow_mod.clean_flow(_s2(f))["flow"]
    assert len(out["nodes"]) == flow_mod.MAX_NODES == 12
    assert [(e["from"], e["to"]) for e in out["edges"]] == [("n0", "n1")]
    assert out["frames"][0]["active_nodes"] == ["n2"]


_FRAME_GHOST = {"stage_index": 0, "active_nodes": ["zzz"], "active_edges": [], "caption": "", "evidence": []}


@pytest.mark.parametrize(
    "bad",
    [
        {"nodes": [], "edges": [], "frames": []},
        {"nodes": [_node("a")], "edges": [], "frames": []},
        {"nodes": [_node("a")], "edges": [], "frames": [_FRAME_GHOST]},
        "not a dict",
        {"nodes": "x", "edges": None, "frames": 3},
    ],
)
def test_unusable_flow_is_omitted_not_an_error(bad):
    out = flow_mod.clean_flow(_s2(bad))
    assert "flow" not in out
    assert out["overview"] == "o"


def test_does_not_mutate_input():
    s2 = _s2(_flow())
    before = copy.deepcopy(s2)
    flow_mod.clean_flow(s2)
    assert s2 == before


def test_no_stages_omits_flow():
    assert "flow" not in flow_mod.clean_flow(_s2(_flow(), n_stages=0))


def test_mock_has_valid_flow_matching_schema():
    s2 = mock.step2(PAGES)
    Step2.model_validate(s2)
    assert s2["flow"]
    assert flow_mod.clean_flow(s2)["flow"] == s2["flow"]
    assert len(s2["flow"]["frames"]) == len(s2["stages"])
    assert any(n["shape"] for n in s2["flow"]["nodes"])
    assert all(n["evidence"] for n in s2["flow"]["nodes"] if n["shape"])


def test_verify_all_covers_node_and_frame_evidence():
    s2 = mock.step2(PAGES)
    s2["flow"]["nodes"][0]["evidence"] = [{"page": 1, "quote": "this text is not in the paper at all"}]
    out = verify_all(s2, [normalize(p) for p in PAGES])
    assert out["flow"]["nodes"][0]["evidence"][0]["verified"] is False
    assert all(e["verified"] is True for n in out["flow"]["nodes"][1:] for e in n["evidence"])
    assert all("verified" in e for fr in out["flow"]["frames"] for e in fr["evidence"])
