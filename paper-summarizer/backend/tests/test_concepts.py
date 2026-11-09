"""Step 1 の前提知識（重要度・出どころ・根拠）のテスト。"""

import json
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app import gemini, mock
from app.concepts import clean_concepts
from app.pdf_utils import normalize, verify_all

PAGES = ["This is the first page of a sample paper about attention and reading support. " * 3, "Second page text with results. " * 5]


@pytest.fixture
def fake(monkeypatch):
    def install(payload):
        chunks = [SimpleNamespace(text=json.dumps(payload))]
        models = SimpleNamespace(calls=[])

        def generate_content_stream(model, contents, config):
            models.calls.append({"contents": contents})
            return iter(chunks)

        models.generate_content_stream = generate_content_stream
        monkeypatch.setattr(gemini, "client", lambda: SimpleNamespace(models=models))
        return models

    return install


def _s1_with(**changes):
    s1 = mock.step1(PAGES, "a.pdf")
    s1["concepts"][0].update(changes)
    return s1


def test_step1_keeps_importance_origin_and_evidence(fake):
    fake(mock.step1(PAGES, "a.pdf"))
    out = gemini.step1(b"%PDF", "undergrad")
    assert {c["origin"] for c in out["concepts"]} == {"paper", "ai_inference"}
    assert {c["importance"] for c in out["concepts"]} == {"essential", "recommended", "advanced"}
    paper = next(c for c in out["concepts"] if c["origin"] == "paper" and c["evidence"])
    assert set(paper["evidence"][0]) >= {"page", "quote"}


def test_step1_prompt_asks_for_importance_origin_and_two_level_limit(fake):
    models = fake(mock.step1(PAGES, "a.pdf"))
    gemini.step1(b"%PDF", "undergrad")
    prompt = models.calls[0]["contents"][1]
    for word in ("importance", "essential", "origin", "ai_inference", "2段"):
        assert word in prompt


def test_step1_old_concepts_without_new_fields_get_defaults(fake):
    s1 = mock.step1(PAGES, "a.pdf")
    for c in s1["concepts"]:
        for k in ("importance", "category", "origin", "evidence"):
            c.pop(k)
    fake(s1)
    out = gemini.step1(b"%PDF", "undergrad")
    assert {c["importance"] for c in out["concepts"]} == {"recommended"}
    assert {c["origin"] for c in out["concepts"]} == {"paper"}
    assert all(c["evidence"] == [] and c["category"] == "concept" for c in out["concepts"])


@pytest.mark.parametrize(
    "bad",
    [
        {"importance": "critical"},
        {"origin": "wikipedia"},
        {"evidence": "see page 2"},
        {"evidence": [{"page": "two", "quote": "x"}]},
        {"category": None},
        {"importance": None, "origin": 3},
    ],
)
def test_step1_bad_new_fields_do_not_fail_the_whole_step(fake, caplog, bad):
    fake(_s1_with(**bad))
    with caplog.at_level("WARNING"):
        out = gemini.step1(b"%PDF", "undergrad")
    assert len(out["concepts"]) == len(mock.step1(PAGES, "a.pdf")["concepts"])
    c = out["concepts"][0]
    assert c["importance"] in {"essential", "recommended", "advanced"}
    assert c["origin"] in {"paper", "ai_inference"}
    assert isinstance(c["evidence"], list)
    assert isinstance(c["category"], str)
    assert any("concept" in r.message for r in caplog.records)


def test_step1_keeps_good_fields_of_other_concepts_when_one_is_bad(fake):
    s1 = _s1_with(importance="critical")
    fake(s1)
    out = gemini.step1(b"%PDF", "undergrad")
    assert out["concepts"][1]["importance"] == s1["concepts"][1]["importance"]


def test_step1_ai_inference_concept_never_carries_evidence(fake):
    fake(_s1_with(origin="ai_inference", evidence=[{"page": 1, "quote": "This is the first page of a sample paper"}]))
    out = gemini.step1(b"%PDF", "undergrad")
    assert out["concepts"][0]["evidence"] == []


def test_step1_core_errors_still_fail(fake):
    s1 = mock.step1(PAGES, "a.pdf")
    s1["concepts"][0]["name"] = None
    fake(s1)
    with pytest.raises(ValidationError):
        gemini.step1(b"%PDF", "undergrad")


def test_step1_concepts_that_are_not_a_list_still_fail(fake):
    s1 = mock.step1(PAGES, "a.pdf")
    s1["concepts"] = "oops"
    fake(s1)
    with pytest.raises(ValidationError):
        gemini.step1(b"%PDF", "undergrad")


def test_paper_concept_evidence_is_verified_by_the_existing_verifier():
    norm = [normalize(p) for p in PAGES]
    out = verify_all(mock.step1(PAGES, "a.pdf"), norm)
    paper = [c for c in out["concepts"] if c["origin"] == "paper" and c["evidence"]]
    assert paper
    assert all(e["verified"] is True for c in paper for e in c["evidence"])
    assert all("verified" not in c for c in out["concepts"])
    assert all(c["evidence"] == [] for c in out["concepts"] if c["origin"] == "ai_inference")


def test_a_quote_not_in_the_pdf_is_flagged_unverified():
    bad = verify_all({"evidence": [{"page": 1, "quote": "this sentence is nowhere in the paper at all"}]}, [normalize(p) for p in PAGES])
    assert bad["evidence"][0]["verified"] is False


# ---------- 論文外の前提は2段まで ----------


def _c(cid, origin, deps=()):
    return {"id": cid, "origin": origin, "depends_on": list(deps), "evidence": []}


def _ids(step1):
    return [c["id"] for c in step1["concepts"]]


def test_ai_inference_beyond_two_steps_from_a_paper_concept_is_dropped():
    s1 = {
        "concepts": [
            _c("p", "paper", ["a1"]),
            _c("a1", "ai_inference", ["a2"]),
            _c("a2", "ai_inference", ["a3"]),
            _c("a3", "ai_inference", ["a4"]),
            _c("a4", "ai_inference"),
        ]
    }
    out = clean_concepts(s1)
    assert _ids(out) == ["p", "a1", "a2"]
    assert next(c for c in out["concepts"] if c["id"] == "a2")["depends_on"] == []  # 外した概念への依存も消す
    assert _ids(s1) == ["p", "a1", "a2", "a3", "a4"]  # 元は変えない


def test_a_shorter_path_through_another_paper_concept_keeps_the_concept():
    s1 = {
        "concepts": [
            _c("p1", "paper", ["a1"]),
            _c("a1", "ai_inference", ["a2"]),
            _c("a2", "ai_inference", ["a3"]),
            _c("a3", "ai_inference"),
            _c("p2", "paper", ["a3"]),
        ]
    }
    assert _ids(clean_concepts(s1)) == ["p1", "a1", "a2", "a3", "p2"]


def test_paper_concepts_are_never_dropped_and_cycles_terminate():
    s1 = {
        "concepts": [
            _c("p", "paper", ["a1"]),
            _c("a1", "ai_inference", ["a2"]),
            _c("a2", "ai_inference", ["a1", "a3"]),
            _c("a3", "ai_inference", ["p"]),
        ]
    }
    assert _ids(clean_concepts(s1)) == ["p", "a1", "a2"]
    loop = {"concepts": [_c("p", "paper", ["p"]), _c("a", "ai_inference", ["b"]), _c("b", "ai_inference", ["a"])]}
    assert _ids(clean_concepts(loop)) == ["p", "a", "b"]  # 論文の概念から届かないものは数えない


def test_step1_applies_the_two_step_limit(fake):
    s1 = mock.step1(PAGES, "a.pdf")
    base = s1["concepts"][1]
    s1["concepts"] = [
        {**s1["concepts"][0], "id": "p", "origin": "paper", "depends_on": ["x1"]},
        {**base, "id": "x1", "origin": "ai_inference", "evidence": [], "depends_on": ["x2"]},
        {**base, "id": "x2", "origin": "ai_inference", "evidence": [], "depends_on": ["x3"]},
        {**base, "id": "x3", "origin": "ai_inference", "evidence": [], "depends_on": []},
    ]
    fake(s1)
    assert _ids(gemini.step1(b"%PDF", "undergrad")) == ["p", "x1", "x2"]


# ---------- 孤立と深さの計測 ----------


def test_concept_stats_counts_isolated_and_max_depth():
    from app.concepts import concept_stats

    concepts = [
        _c("a", "paper", ["b"]),
        _c("b", "paper", ["c"]),
        _c("c", "ai_inference"),
        _c("lonely", "paper"),
        _c("selfdep", "paper", ["selfdep", "ghost"]),  # 自分と存在しない概念への依存は数えない
    ]
    assert concept_stats(concepts) == {"concepts": 5, "edges": 2, "isolated": 2, "max_depth": 2}


def test_concept_stats_handles_cycles_and_empty():
    from app.concepts import concept_stats

    assert concept_stats([]) == {"concepts": 0, "edges": 0, "isolated": 0, "max_depth": 0}
    cyc = [_c("a", "paper", ["b"]), _c("b", "paper", ["a"])]
    assert concept_stats(cyc)["isolated"] == 0


def test_clean_concepts_logs_stats_without_removing_isolated(caplog):
    s1 = {"concepts": [_c("a", "paper", ["b"]), _c("b", "paper"), _c("lonely", "paper")]}
    with caplog.at_level("INFO", logger="paper"):
        out = clean_concepts(s1)
    assert _ids(out) == ["a", "b", "lonely"]
    assert any("isolated=1" in r.getMessage() and "max_depth=1" in r.getMessage() for r in caplog.records)
