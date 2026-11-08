"""Step 1 の「先に読むとよい論文」（foundations）のテスト。"""

import json
from types import SimpleNamespace

import pytest

from app import config, gemini, mock
from app.foundations import MAX_FOUNDATIONS, clean_foundations
from app.pdf_utils import normalize, verify_all
from app.schemas import Step1

PAGES = ["This is the first page of a sample paper about attention and reading support. " * 3, "Second page text with results. " * 5]


@pytest.fixture
def fake(monkeypatch):
    def install(payload):
        resp = SimpleNamespace(parsed=None, text=json.dumps(payload))
        calls = []

        def generate_content(model, contents, config):
            calls.append(contents)
            return resp

        monkeypatch.setattr(gemini, "client", lambda: SimpleNamespace(models=SimpleNamespace(generate_content=generate_content)))
        return calls

    return install


def _f(**changes):
    base = {
        "title": "Some Base Paper",
        "authors": "A. Author, B. Author",
        "year": 2015,
        "reason": "手法のもとになっている。",
        "order": 1,
        "doi": None,
        "arxiv_id": None,
        "evidence": [{"page": 1, "quote": "This is the first page of a sample paper"}],
    }
    return {**base, **changes}


def _s1(foundations):
    return {**mock.step1(PAGES, "a.pdf"), "foundations": foundations}


def test_analysis_version_was_bumped_for_the_new_shape():
    assert config.ANALYSIS_VERSION >= 7


def test_mock_step1_has_verifiable_foundations():
    out = verify_all(mock.step1(PAGES, "a.pdf"), [normalize(p) for p in PAGES])
    assert 1 <= len(out["foundations"]) <= 5
    assert all(e["verified"] is True for f in out["foundations"] for e in f["evidence"])
    Step1.model_validate(out)


def test_old_results_without_foundations_get_an_empty_list(fake):
    s1 = mock.step1(PAGES, "a.pdf")
    s1.pop("foundations")
    fake(s1)
    assert gemini.step1(b"%PDF", "undergrad")["foundations"] == []


def test_prompt_restricts_choice_to_the_reference_list(fake):
    calls = fake(_s1([_f()]))
    gemini.step1(b"%PDF", "undergrad")
    prompt = calls[0][1]
    for word in ("foundations", "参考文献", "作らない", "対象の論文での使われ方"):
        assert word in prompt


@pytest.mark.parametrize(
    "bad",
    [
        "oops",
        {"title": "x"},
        [{"title": "x"}],
        [_f(year="2015 年")],
        [_f(order="first")],
        [_f(evidence="p.2")],
        [_f(evidence=[{"page": "two", "quote": "q"}])],
        [_f(title=None)],
    ],
)
def test_broken_foundations_do_not_fail_step1(fake, caplog, bad):
    fake(_s1(bad))
    with caplog.at_level("WARNING"):
        out = gemini.step1(b"%PDF", "undergrad")
    assert len(out["concepts"]) == len(mock.step1(PAGES, "a.pdf")["concepts"])
    assert out["foundations"] == []
    assert any("foundations" in r.message for r in caplog.records)


def test_one_broken_foundation_keeps_the_good_ones(fake):
    fake(_s1([_f(title="Good"), _f(year="x", title="Bad")]))
    assert [f["title"] for f in gemini.step1(b"%PDF", "undergrad")["foundations"]] == ["Good"]


def test_foundations_are_cleaned_by_the_server(fake):
    fake(_s1([_f(title=f"P{i}", order=10 - i) for i in range(8)]))
    out = gemini.step1(b"%PDF", "undergrad")["foundations"]
    assert len(out) == MAX_FOUNDATIONS
    assert [f["title"] for f in out] == ["P7", "P6", "P5", "P4", "P3"]


def _clean(items):
    return clean_foundations({"foundations": items})["foundations"]


def test_clean_sorts_renumbers_and_drops_empty_titles():
    out = _clean([_f(title="B", order=3), _f(title="   ", order=1), _f(title="A", order=2)])
    assert [(f["title"], f["order"]) for f in out] == [("A", 1), ("B", 2)]


def test_clean_drops_duplicate_titles():
    out = _clean([_f(title="Same Paper", order=1), _f(title=" same  paper ", order=2)])
    assert len(out) == 1


@pytest.mark.parametrize(
    "doi,expected",
    [
        ("10.1145/3292500.3330701", "10.1145/3292500.3330701"),
        (" 10.1000/abc ", "10.1000/abc"),
        ("https://doi.org/10.1000/abc", "10.1000/abc"),
        ("doi:10.1000/abc", "10.1000/abc"),
        ("javascript:alert(1)", None),
        ("https://evil.example/10.1000/abc", None),
        ("10.1000/a b", None),
        ("10.1000/<script>", None),
        ("11.1000/abc", None),
        ("", None),
        (None, None),
        (123, None),
    ],
)
def test_clean_doi(doi, expected):
    assert _clean([_f(doi=doi)])[0]["doi"] == expected


@pytest.mark.parametrize(
    "aid,expected",
    [
        ("1706.03762", "1706.03762"),
        ("arXiv:1706.03762v5", "1706.03762v5"),
        (" 2301.12345 ", "2301.12345"),
        ("https://arxiv.org/abs/1706.03762", "1706.03762"),
        ("abc", None),
        ("1706.03762/../x", None),
        ("1706", None),
        ("", None),
        (None, None),
    ],
)
def test_clean_arxiv_id(aid, expected):
    assert _clean([_f(arxiv_id=aid)])[0]["arxiv_id"] == expected


def test_clean_does_not_mutate_the_input_and_tolerates_a_missing_key():
    s1 = _s1([_f(title="B", order=2), _f(title="A", order=1)])
    before = json.dumps(s1)
    clean_foundations(s1)
    assert json.dumps(s1) == before
    assert clean_foundations({"title": "x"}) == {"title": "x", "foundations": []}
