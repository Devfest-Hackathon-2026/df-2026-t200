import pymupdf
import pytest

from app.pdf_utils import TooManyPages, TooMuchText, extract_pages, normalize, verify_all, verify_evidence


def test_extract_pages_rejects_page_count_before_reading_text(sample_pdf, monkeypatch):
    calls = []
    monkeypatch.setattr(pymupdf.Page, "get_text", lambda *_a, **_k: calls.append(1) or "")
    with pytest.raises(TooManyPages) as e:
        extract_pages(sample_pdf, max_pages=2)
    assert e.value.count == 3
    assert calls == []


def test_extract_pages_stops_when_text_exceeds_limit(sample_pdf, monkeypatch):
    calls = []
    monkeypatch.setattr(pymupdf.Page, "get_text", lambda *_a, **_k: calls.append(1) or "x" * 100)
    with pytest.raises(TooMuchText):
        extract_pages(sample_pdf, max_chars=150)
    assert len(calls) == 2  # 上限を超えた時点で抽出をやめる


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
    assert ev == {"page": 2, "quote": "This sentence belongs to page 2 of the sample.", "verified": True, "page_corrected": False}


def test_verify_evidence_corrects_neighbor_page(sample_pdf):
    ev = verify_evidence({"page": 1, "quote": "belongs to page 3 of the sample"}, _norm_pages(sample_pdf))
    assert ev["page"] == 3
    assert ev["verified"] is True
    assert ev["page_corrected"] is True
    assert ev["claimed_page"] == 1


def test_verify_evidence_searches_all_pages_when_far():
    pages = [normalize(t) for t in ["alpha", "beta", "gamma", "delta", "epsilon", "zeta unique quote here"]]
    ev = verify_evidence({"page": 1, "quote": "zeta unique quote here"}, pages)
    assert ev["page"] == 6
    assert ev["verified"] is True


def test_verify_evidence_accepts_long_quote_when_most_words_match(sample_pdf):
    quote = "We study how attention mechanisms help students read long scientific documents in a PARAPHRASED ENDING HERE"
    ev = verify_evidence({"page": 1, "quote": quote}, _norm_pages(sample_pdf))
    assert ev["verified"] is True


def test_verify_evidence_rejects_half_fabricated_quote(sample_pdf):
    quote = "We study how attention mechanisms help students read long PARAPHRASED WORDS THAT DO NOT APPEAR ANYWHERE"
    ev = verify_evidence({"page": 1, "quote": quote}, _norm_pages(sample_pdf))
    assert ev["verified"] is False


def test_verify_evidence_rejects_fabricated_start_with_real_tail(sample_pdf):
    quote = "SOME INVENTED OPENING WORDS GO HERE NOW in a structured way This sentence belongs"
    ev = verify_evidence({"page": 1, "quote": quote}, _norm_pages(sample_pdf))
    assert ev["verified"] is False


def test_verify_evidence_marks_unverified_and_clamps_page(sample_pdf):
    ev = verify_evidence({"page": 99, "quote": "completely fabricated sentence"}, _norm_pages(sample_pdf))
    assert ev["verified"] is False
    assert ev["page"] == 3
    assert ev["claimed_page"] == 99


def test_verify_evidence_empty_quote_is_unverified(sample_pdf):
    ev = verify_evidence({"page": 0, "quote": ""}, _norm_pages(sample_pdf))
    assert ev["page"] == 1
    assert ev["verified"] is False


def test_verify_all_walks_nested_structures_without_mutating(sample_pdf):
    original = {"stages": [{"title": "x", "evidence": [{"page": 2, "quote": "page 2 of the sample"}]}], "n": 1}
    out = verify_all(original, _norm_pages(sample_pdf))
    assert out["stages"][0]["evidence"][0]["verified"] is True
    assert out["n"] == 1
    assert "verified" not in original["stages"][0]["evidence"][0]


def test_verify_evidence_rejects_too_short_quote(sample_pdf):
    # 「the sample」はどのページにもあるので、短い引用は根拠として認めない
    ev = verify_evidence({"page": 1, "quote": "of the sample"}, _norm_pages(sample_pdf))
    assert ev["verified"] is False


def test_verify_evidence_requires_word_boundaries():
    pages = [normalize("Large models are trained on very big corpora of text.")]
    assert verify_evidence({"page": 1, "quote": "model are trained on very big corpora"}, pages)["verified"] is False
    assert verify_evidence({"page": 1, "quote": "odels are trained on very big corpora"}, pages)["verified"] is False
    assert verify_evidence({"page": 1, "quote": "models are trained on very big corpora"}, pages)["verified"] is True


def test_verify_evidence_handles_hyphenation_consistently():
    pages = [normalize("These well-\nknown results show that the method works on state-of-the-art data.")]
    assert verify_evidence({"page": 1, "quote": "these well-known results show that"}, pages)["verified"] is True
    assert verify_evidence({"page": 1, "quote": "the method works on state-of-the-art data"}, pages)["verified"] is True


def test_normalize_treats_inline_and_line_break_hyphens_the_same():
    assert normalize("well-\nknown") == normalize("well-known") == normalize("well\u2010known")


def test_verify_evidence_accepts_long_non_ascii_quote():
    pages = [normalize("本研究では、注意機構を用いて長い科学文書を構造的に読む方法を提案する。")]
    ev = verify_evidence({"page": 1, "quote": "注意機構を用いて長い科学文書を構造的に読む方法"}, pages)
    assert ev["verified"] is True
    assert verify_evidence({"page": 1, "quote": "注意機構"}, pages)["verified"] is False


def test_verify_evidence_keeps_claimed_page_absent_when_not_corrected(sample_pdf):
    ev = verify_evidence({"page": 2, "quote": "This sentence belongs to page 2 of the sample."}, _norm_pages(sample_pdf))
    assert "claimed_page" not in ev
