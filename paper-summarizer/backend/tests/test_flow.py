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


@pytest.mark.parametrize("bad_ref", [["a"], {"x": 1}, 3, None])
def test_non_string_edge_endpoints_do_not_crash(bad_ref):
    f = _flow()
    f["edges"].append({"from": bad_ref, "to": "b", "label": ""})
    f["edges"].append({"from": "a", "to": bad_ref, "label": ""})
    out = flow_mod.clean_flow(_s2(f))["flow"]
    assert [(e["from"], e["to"]) for e in out["edges"]] == [("a", "b"), ("b", "c")]


@pytest.mark.parametrize("bad_id", [["a"], {"x": 1}, 3, None, ""])
def test_non_string_node_ids_are_dropped(bad_id):
    f = _flow()
    f["nodes"].append({**_node("z"), "id": bad_id})
    out = flow_mod.clean_flow(_s2(f))["flow"]
    assert [n["id"] for n in out["nodes"]] == ["a", "b", "c"]


@pytest.mark.parametrize("bad_list", [["a", ["x"], {"k": 1}, 5], "a"])
def test_non_string_active_refs_are_dropped(bad_list):
    f = _flow()
    f["frames"][0]["active_nodes"] = bad_list
    f["frames"][0]["active_edges"] = bad_list
    out = flow_mod.clean_flow(_s2(f))["flow"]
    assert out["frames"][0]["active_nodes"] in (["a"], [])
    assert out["frames"][0]["active_edges"] == []


def test_edge_count_is_capped():
    ids = [f"n{k}" for k in range(12)]
    f = {
        "nodes": [_node(i) for i in ids],
        "edges": [{"from": a, "to": b, "label": ""} for a in ids for b in ids if a != b],
        "frames": [{"stage_index": 0, "active_nodes": [], "active_edges": [], "caption": "", "evidence": []}],
    }
    assert len(flow_mod.clean_flow(_s2(f))["flow"]["edges"]) == flow_mod.MAX_EDGES


def test_omitting_flow_is_logged(caplog):
    with caplog.at_level("WARNING"):
        flow_mod.clean_flow(_s2({"nodes": [], "edges": [], "frames": []}))
    assert any("flow" in r.message for r in caplog.records)


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


# ---------- 段階（group） ----------


def _grouped(groups):
    f = _flow()
    for n, g in zip(f["nodes"], groups, strict=True):
        n["group"] = g
    return f


def test_group_is_trimmed_collapsed_and_capped_in_length():
    f = _grouped(["  事前   学習 ", "x" * 50, "微調整"])
    out = flow_mod.clean_flow(_s2(f))["flow"]
    assert [n["group"] for n in out["nodes"]] == ["事前 学習", "x" * flow_mod.MAX_GROUP_LEN, "微調整"]


@pytest.mark.parametrize("bad", ["", "   ", None, 3, ["a"], {"k": 1}, True])
def test_unusable_group_becomes_none_without_dropping_the_flow(bad):
    out = flow_mod.clean_flow(_s2(_grouped([bad, "A", "A"])))["flow"]
    assert out["nodes"][0]["group"] is None
    assert [n["group"] for n in out["nodes"][1:]] == ["A", "A"]


def test_group_kinds_are_capped_keeping_the_first_ones():
    f = {
        "nodes": [{**_node(f"n{k}"), "group": f"g{k}"} for k in range(6)],
        "edges": [{"from": "n0", "to": "n1", "label": ""}],
        "frames": [{"stage_index": 0, "active_nodes": [], "active_edges": [], "caption": "", "evidence": []}],
    }
    out = flow_mod.clean_flow(_s2(f))["flow"]
    groups = [n["group"] for n in out["nodes"]]
    assert groups == ["g0", "g1", "g2", "g3", None, None] and flow_mod.MAX_GROUPS == 4


def test_old_flow_without_group_is_unchanged():
    out = flow_mod.clean_flow(_s2(_flow()))["flow"]
    assert all("group" not in n for n in out["nodes"])


def test_clean_flow_does_not_mutate_group_input():
    f = _grouped(["  A ", "A", "B"])
    before = copy.deepcopy(f)
    flow_mod.clean_flow(_s2(f))
    assert f == before


def test_repair_flow_groups_fixes_only_group_fields():
    raw = _s2(_grouped([["x"], 5, "ok"]))
    fixed = flow_mod.repair_flow_groups(raw)
    assert [n.get("group") for n in fixed["flow"]["nodes"]] == [None, None, "ok"]
    assert raw["flow"]["nodes"][0]["group"] == ["x"]  # 元は変えない
    assert flow_mod.repair_flow_groups({"flow": None}) == {"flow": None}
    assert flow_mod.repair_flow_groups("x") == "x"


def test_mock_flow_has_groups_and_a_branch_and_merge():
    s2 = Step2.model_validate(mock.step2(PAGES)).model_dump(by_alias=True)
    nodes, edges = s2["flow"]["nodes"], s2["flow"]["edges"]
    assert len({n["group"] for n in nodes if n["group"]}) >= 2
    out_deg = {n["id"]: sum(e["from"] == n["id"] for e in edges) for n in nodes}
    in_deg = {n["id"]: sum(e["to"] == n["id"] for e in edges) for n in nodes}
    assert max(out_deg.values()) >= 2 and max(in_deg.values()) >= 2
    assert flow_mod.clean_flow(s2)["flow"] is not None
