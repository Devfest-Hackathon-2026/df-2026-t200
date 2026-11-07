"""Step 2 の式（equations）と Step 1 の前提知識を結ぶ concepts のテスト。"""

import copy
import json
from types import SimpleNamespace

import pytest

from app import concepts as concepts_mod
from app import config, gemini, mock
from app.schemas import Step2

PAGES = ["This is the first page of a sample paper about attention and reading support. " * 3, "Second page text with results. " * 5]


class FakeModels:
    def __init__(self, payload):
        self.payload = payload
        self.calls = []

    def generate_content(self, model, contents, config):
        self.calls.append({"contents": contents})
        return SimpleNamespace(parsed=None, text=json.dumps(self.payload))


@pytest.fixture
def fake(monkeypatch):
    def install(payload):
        models = FakeModels(payload)
        monkeypatch.setattr(gemini, "client", lambda: SimpleNamespace(models=models))
        return models

    return install


def _equations(s2):
    return [e for st in s2["stages"] for e in st["equations"]]


def test_analysis_version_is_bumped():
    assert config.ANALYSIS_VERSION >= 4


def test_mock_equation_links_to_existing_step1_concepts():
    ids = {c["id"] for c in mock.step1(PAGES, "a.pdf")["concepts"]}
    eqs = _equations(mock.step2(PAGES))
    assert eqs and eqs[0]["concepts"]
    assert set(eqs[0]["concepts"]) <= ids


def test_concepts_defaults_to_empty_for_old_results():
    s2 = copy.deepcopy(mock.step2(PAGES))
    del s2["stages"][1]["equations"][0]["concepts"]
    assert Step2.model_validate(s2).stages[1].equations[0].concepts == []


def test_step2_prompt_lists_step1_concept_ids(fake):
    s1 = mock.step1(PAGES, "a.pdf")
    models = fake(mock.step2(PAGES))
    gemini.step2(b"%PDF", "undergrad", s1)
    prompt = models.calls[0]["contents"][1]
    assert "concepts" in prompt
    assert all(c["id"] in prompt for c in s1["concepts"])


def test_unknown_concept_ids_are_dropped_and_duplicates_removed(fake):
    s1 = mock.step1(PAGES, "a.pdf")
    s2 = mock.step2(PAGES)
    s2["stages"][1]["equations"][0]["concepts"] = ["softmax", "ghost", "softmax", "attention"]
    fake(s2)
    out = gemini.step2(b"%PDF", "undergrad", s1)
    assert _equations(out)[0]["concepts"] == ["softmax", "attention"]


def test_clean_does_not_mutate_input():
    s2 = mock.step2(PAGES)
    s2["stages"][1]["equations"][0]["concepts"] = ["ghost"]
    before = copy.deepcopy(s2)
    out = concepts_mod.clean_equation_concepts(s2, {"softmax"})
    assert s2 == before
    assert _equations(out)[0]["concepts"] == []


@pytest.mark.parametrize("bad", ["softmax", 3, {"a": 1}, [1, None], ["softmax", 2]])
def test_invalid_concepts_do_not_fail_step2(fake, bad):
    s2 = mock.step2(PAGES)
    s2["stages"][1]["equations"][0]["concepts"] = bad
    fake(s2)
    out = gemini.step2(b"%PDF", "undergrad", mock.step1(PAGES, "a.pdf"))
    assert len(out["stages"]) == len(s2["stages"])
    assert isinstance(_equations(out)[0]["concepts"], list)
    assert "flow" in out  # flow まで失われない


def test_invalid_concepts_and_invalid_flow_both_handled(fake):
    s2 = mock.step2(PAGES)
    s2["stages"][1]["equations"][0]["concepts"] = "x"
    s2["flow"]["nodes"][0]["kind"] = "banana"
    fake(s2)
    out = gemini.step2(b"%PDF", "undergrad", mock.step1(PAGES, "a.pdf"))
    assert "flow" not in out
    assert len(out["stages"]) == len(s2["stages"])


def test_step2_without_step1_concepts_still_works(fake):
    fake(mock.step2(PAGES))
    out = gemini.step2(b"%PDF", "undergrad", {"title": "t"})
    assert _equations(out)[0]["concepts"] == []
