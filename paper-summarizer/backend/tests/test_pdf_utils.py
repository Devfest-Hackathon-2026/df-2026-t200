from app.pdf_utils import extract_pages, normalize, verify_all, verify_evidence


def test_extract_pages_returns_text_per_page(sample_pdf):
    pages = extract_pages(sample_pdf)
    assert len(pages) == 3
    assert "page 2 of the sample" in pages[1]


def test_normalize_joins_hyphenation_and_strips_symbols():
    assert normalize("Atten-\ntion  is ALL\nyou need!") == "attention is all you need"


def test_normalize_applies_nfkc_and_soft_hyphen():
    assert normalize("ｆｕｌｌ­width") == "fullwidth"


def _norm_pages(pdf):
    return [normalize(p) for p in extract_pages(pdf)]


def test_verify_evidence_exact_page(sample_pdf):
    ev = verify_evidence({"page": 2, "quote": "This sentence belongs to page 2 of the sample."}, _norm_pages(sample_pdf))
    assert ev == {"page": 2, "quote": "This sentence belongs to page 2 of the sample.", "verified": True}


def test_verify_evidence_corrects_neighbor_page(sample_pdf):
    ev = verify_evidence({"page": 1, "quote": "belongs to page 3 of the sample"}, _norm_pages(sample_pdf))
    assert ev["page"] == 3
    assert ev["verified"] is True


def test_verify_evidence_searches_all_pages_when_far():
    pages = [normalize(t) for t in ["alpha", "beta", "gamma", "delta", "epsilon", "zeta unique quote here"]]
    ev = verify_evidence({"page": 1, "quote": "zeta unique quote here"}, pages)
    assert ev["page"] == 6
    assert ev["verified"] is True


def test_verify_evidence_accepts_long_quote_with_half_match(sample_pdf):
    quote = "We study how attention mechanisms help students read long PARAPHRASED WORDS THAT DO NOT APPEAR ANYWHERE"
    ev = verify_evidence({"page": 1, "quote": quote}, _norm_pages(sample_pdf))
    assert ev["verified"] is True


def test_verify_evidence_marks_unverified_and_clamps_page(sample_pdf):
    ev = verify_evidence({"page": 99, "quote": "completely fabricated sentence"}, _norm_pages(sample_pdf))
    assert ev["verified"] is False
    assert ev["page"] == 3


def test_verify_evidence_empty_quote_is_unverified(sample_pdf):
    assert verify_evidence({"page": 0, "quote": ""}, _norm_pages(sample_pdf)) == {"page": 1, "quote": "", "verified": False}


def test_verify_all_walks_nested_structures_without_mutating(sample_pdf):
    original = {"stages": [{"title": "x", "evidence": [{"page": 2, "quote": "page 2 of the sample"}]}], "n": 1}
    out = verify_all(original, _norm_pages(sample_pdf))
    assert out["stages"][0]["evidence"][0]["verified"] is True
    assert out["n"] == 1
    assert "verified" not in original["stages"][0]["evidence"][0]
