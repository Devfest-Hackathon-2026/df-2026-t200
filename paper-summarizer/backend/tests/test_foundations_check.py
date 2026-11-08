"""照合後の foundations の確認（参考文献に載っている論文だけ）のテスト。"""

import json

from app import mock, services
from app.foundations import check_foundations, clean_foundations
from app.pdf_utils import normalize, verify_all

REF_PAGES = [
    "Intro. We build on Base Paper One for the method design in this work.\nReferences\n[1] A. Author. Base Paper One. doi:10.1000/abc.123 2015.\n[2] arXiv:1706.03762",
]
GOOD_QUOTE = "We build on Base Paper One for the method design"
FAKE_QUOTE = "this sentence is nowhere in the paper at all really"


def _f(**changes):
    base = {
        "title": "Some Base Paper",
        "authors": "A. Author",
        "year": 2015,
        "reason": "手法のもとになっている。",
        "order": 1,
        "doi": None,
        "arxiv_id": None,
        "evidence": [{"page": 1, "quote": GOOD_QUOTE}],
    }
    return {**base, **changes}


def _checked(items, pages=REF_PAGES):
    norm = [normalize(p) for p in pages]
    return check_foundations(verify_all({"foundations": items}, norm), norm)["foundations"]


def test_drops_a_foundation_with_no_verified_evidence():
    out = _checked(
        [
            _f(title="Good"),
            _f(title="NoEv", order=2, evidence=[]),
            _f(title="Fake", order=3, evidence=[{"page": 1, "quote": FAKE_QUOTE}]),
        ]
    )
    assert [f["title"] for f in out] == ["Good"]


def test_renumbers_the_order_after_dropping():
    out = _checked([_f(title="Fake", order=1, evidence=[]), _f(title="Good", order=2)])
    assert [(f["title"], f["order"]) for f in out] == [("Good", 1)]


def test_keeps_a_foundation_when_one_of_its_evidence_verifies():
    ev = [{"page": 1, "quote": FAKE_QUOTE}, {"page": 1, "quote": GOOD_QUOTE}]
    assert len(_checked([_f(evidence=ev)])) == 1


def test_keeps_ids_that_appear_in_the_pdf_text():
    out = _checked([_f(doi="10.1000/abc.123", arxiv_id="1706.03762")])
    assert (out[0]["doi"], out[0]["arxiv_id"]) == ("10.1000/abc.123", "1706.03762")


def test_nulls_ids_that_do_not_appear_in_the_pdf_text():
    out = _checked([_f(doi="10.1000/zzz", arxiv_id="2301.99999")])
    assert (out[0]["doi"], out[0]["arxiv_id"]) == (None, None)


def test_does_not_mutate_the_input_and_tolerates_a_missing_key():
    norm = [normalize(p) for p in REF_PAGES]
    s1 = verify_all({"foundations": [_f(doi="10.1000/zzz")]}, norm)
    before = json.dumps(s1)
    check_foundations(s1, norm)
    assert json.dumps(s1) == before
    assert check_foundations({"title": "x"}, norm) == {"title": "x", "foundations": []}


def test_the_analysis_path_runs_the_check_after_verification_including_demo_mode():
    pages = ["This is the first page of a sample paper about attention and reading support. " * 3, "Second page text with results. " * 5]
    norm = [normalize(p) for p in pages]
    assert len(services.finalize_step("step1", mock.step1(pages, "a.pdf"), norm)["foundations"]) == 3
    bad = {**mock.step1(pages, "a.pdf"), "foundations": [_f(evidence=[{"page": 1, "quote": FAKE_QUOTE}])]}
    assert services.finalize_step("step1", bad, norm)["foundations"] == []
    assert services.finalize_step("step2", {"x": 1}, norm) == {"x": 1}


def test_regexes_do_not_accept_fullwidth_digits():
    # NFKC に頼らず、サーバーの整形の段階で全角数字は弾く
    out = clean_foundations({"foundations": [_f(doi="10.１０００/abc", arxiv_id="１７０６.０３７６２")]})
    assert (out["foundations"][0]["doi"], out["foundations"][0]["arxiv_id"]) == (None, None)
