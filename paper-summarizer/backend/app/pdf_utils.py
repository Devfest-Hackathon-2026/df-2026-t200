"""PDF のテキスト抽出と、Gemini が返した引用の照合。

Gemini の引用を鵜呑みにせず、実際に PDF の該当ページに存在するかをサーバー側で確かめる。
指定ページになくても前後のページで見つかればページ番号を補正する。
"""

import re
import unicodedata
from typing import Any

import pymupdf


def extract_pages(pdf_bytes: bytes) -> list[str]:
    with pymupdf.open(stream=pdf_bytes, filetype="pdf") as doc:
        return [page.get_text() for page in doc]


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    text = text.replace("­", "")
    text = re.sub(r"-\s*\n\s*", "", text)  # 行末ハイフネーションを連結
    text = text.lower()
    text = re.sub(r"[^\w]+", " ", text)  # 記号・改行・空白をまとめて1つの空白に
    return text.strip()


def _found(norm_quote: str, norm_page: str) -> bool:
    if not norm_quote:
        return False
    if norm_quote in norm_page:
        return True
    # 長い引用は一部の言い換えを許容し、前半・後半どちらかが一致すれば可とする
    words = norm_quote.split()
    if len(words) >= 8:
        half = len(words) // 2
        return " ".join(words[:half]) in norm_page or " ".join(words[half:]) in norm_page
    return False


def verify_evidence(ev: dict[str, Any], norm_pages: list[str]) -> dict[str, Any]:
    quote = normalize(ev.get("quote") or "")
    page = ev.get("page") or 0
    n = len(norm_pages)
    candidates = [page] + [p for p in (page - 1, page + 1, page - 2, page + 2) if 1 <= p <= n]
    for p in candidates:
        if 1 <= p <= n and _found(quote, norm_pages[p - 1]):
            return {**ev, "page": p, "verified": True}
    for p in range(1, n + 1):
        if _found(quote, norm_pages[p - 1]):
            return {**ev, "page": p, "verified": True}
    return {**ev, "page": min(max(page, 1), max(n, 1)), "verified": False}


def verify_all(obj: Any, norm_pages: list[str]) -> Any:
    """dict / list を再帰的にたどり、Evidence 形（page と quote を持つ dict）をすべて照合する。"""
    if isinstance(obj, dict):
        if "quote" in obj and "page" in obj:
            return verify_evidence(obj, norm_pages)
        return {k: verify_all(v, norm_pages) for k, v in obj.items()}
    if isinstance(obj, list):
        return [verify_all(v, norm_pages) for v in obj]
    return obj
