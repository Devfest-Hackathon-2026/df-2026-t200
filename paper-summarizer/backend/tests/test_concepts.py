"""Step 1 の前提知識（重要度・出どころ・根拠）のテスト。"""

import json
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app import gemini, mock
from app.pdf_utils import normalize, verify_all

PAGES = ["This is the first page of a sample paper about attention and reading support. " * 3, "Second page text with results. " * 5]


@pytest.fixture
def fake(monkeypatch):
    def install(payload):
        resp = SimpleNamespace(parsed=None, text=json.dumps(payload))
        models = SimpleNamespace(generate_content=lambda **_k: resp, calls=[])

        def generate_content(model, contents, config):
            models.calls.append({"contents": contents})
            return resp

        models.generate_content = generate_content
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
