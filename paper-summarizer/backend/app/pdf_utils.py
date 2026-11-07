"""PDF のテキスト抽出と、Gemini が返した引用の照合。

Gemini の引用を鵜呑みにせず、実際に PDF の該当ページに存在するかをサーバー側で確かめる。
指定ページになくても前後のページで見つかればページ番号を補正し、補正したことを page_corrected / claimed_page で残す。
"""

import math
import re
import threading
import unicodedata
from typing import Any

import pypdfium2 as pdfium

# PDFium は同じプロセスの複数スレッドから同時に呼べない（pypdfium2 も排他しない）。
# アップロードはスレッドプールで、解析はバックグラウンドスレッドで動くので、PDFium の呼び出しはこのロックの中だけで行う。
_PDFIUM_LOCK = threading.Lock()


class TooManyPages(ValueError):
    def __init__(self, count: int):
        super().__init__(f"too many pages: {count}")
        self.count = count


class TooMuchText(ValueError):
    pass


def _page_text(page: pdfium.PdfPage) -> str:
    """1ページの本文を返す。改行は \\n にそろえる。

    PDFium は行末のハイフネーション（Atten-\\ntion）を U+FFFE 1文字に置き換えて改行を消すので、
    「-\\n」に戻す。normalize が語をつなげられ、PyMuPDF で抽出していたころと同じ形になる。
    """
    textpage = page.get_textpage()
    try:
        text = textpage.get_text_range()
    finally:
        textpage.close()
    return text.replace("\r\n", "\n").replace("\r", "\n").replace("\ufffe", "-\n")


def extract_pages(pdf_bytes: bytes, max_pages: int | None = None, max_chars: int | None = None) -> list[str]:
    """ページごとの本文を返す。

    max_pages を超えるページ数なら、本文を抽出する前に TooManyPages を出す（重い PDF で CPU とメモリを使い切らない）。
    抽出した文字数の合計が max_chars を超えたら、その時点で TooMuchText を出す。
    壊れた PDF やパスワード付きの PDF は pypdfium2 の PdfiumError を出す。
    """
    with _PDFIUM_LOCK:
        return _extract_locked(pdf_bytes, max_pages, max_chars)


def _extract_locked(pdf_bytes: bytes, max_pages: int | None, max_chars: int | None) -> list[str]:
    doc = pdfium.PdfDocument(pdf_bytes)
    try:
        count = len(doc)
        if max_pages is not None and count > max_pages:
            raise TooManyPages(count)
        pages: list[str] = []
        total = 0
        for i in range(count):
            page = doc[i]
            try:
                text = _page_text(page)
            finally:
                page.close()
            total += len(text)
            if max_chars is not None and total > max_chars:
                raise TooMuchText(f"text exceeds {max_chars} chars")
            pages.append(text)
        return pages
    finally:
        doc.close()


# 引用として認める最低の長さ。「the model」のような短い句はほぼどのページにもあるので根拠にならない。
MIN_QUOTE_CHARS = 20
MIN_QUOTE_WORDS = 4
# 長い引用は多少の言い換えを許すが、先頭側または末尾側の連続した 60% 以上の語が原文と一致することを求める。
PARTIAL_MIN_WORDS = 10
PARTIAL_RATIO = 0.6

_HYPHENS = "-\u2010\u2011"


def normalize(text: str) -> str:
    """照合用に正規化する。ページ側と引用側の両方に同じ処理をかける。

    ハイフンは「行末のハイフネーション（Atten-\\ntion）」も「語中のハイフン（well-known）」も
    取り除いて語をつなげる。ページの行末で分かれた語と、引用側でハイフン付きで書かれた語が同じ形になる。
    """
    text = unicodedata.normalize("NFKC", text)
    text = text.replace("\u00ad", "")
    text = re.sub(rf"[{_HYPHENS}]\s*\n\s*", "", text)  # 行末ハイフネーションを連結
    text = re.sub(rf"(?<=\w)[{_HYPHENS}](?=\w)", "", text)  # 語中のハイフンも同じく連結
    text = text.lower()
    text = re.sub(r"[^\w]+", " ", text)  # 記号・改行・空白をまとめて1つの空白に
    return text.strip()


def _long_enough(norm_quote: str) -> bool:
    if len(norm_quote) < MIN_QUOTE_CHARS:
        return False
    # 日本語など空白で区切らない言語は語数を数えられないので文字数だけで判定する
    return not norm_quote.isascii() or len(norm_quote.split()) >= MIN_QUOTE_WORDS


def _contains(norm_page: str, phrase: str) -> bool:
    if not phrase.isascii():
        return phrase in norm_page
    return f" {phrase} " in f" {norm_page} "  # 単語の境界で照合（model が models に一致しない）


def _found(norm_quote: str, norm_page: str) -> bool:
    if not _long_enough(norm_quote):
        return False
    if _contains(norm_page, norm_quote):
        return True
    words = norm_quote.split()
    if len(words) < PARTIAL_MIN_WORDS:
        return False
    k = math.ceil(len(words) * PARTIAL_RATIO)
    return _contains(norm_page, " ".join(words[:k])) or _contains(norm_page, " ".join(words[-k:]))


def _result(ev: dict[str, Any], page: int, verified: bool) -> dict[str, Any]:
    claimed = ev.get("page")
    out = {**ev, "page": page, "verified": verified, "page_corrected": page != claimed}
    if page != claimed:
        out["claimed_page"] = claimed  # Gemini が示したページ（誤りの記録として残す）
    return out


def verify_evidence(ev: dict[str, Any], norm_pages: list[str]) -> dict[str, Any]:
    quote = normalize(ev.get("quote") or "")
    page = ev.get("page") or 0
    n = len(norm_pages)
    candidates = [page] + [p for p in (page - 1, page + 1, page - 2, page + 2) if 1 <= p <= n]
    for p in candidates:
        if 1 <= p <= n and _found(quote, norm_pages[p - 1]):
            return _result(ev, p, True)
    for p in range(1, n + 1):
        if _found(quote, norm_pages[p - 1]):
            return _result(ev, p, True)
    return _result(ev, min(max(page, 1), max(n, 1)), False)


def verify_all(obj: Any, norm_pages: list[str]) -> Any:
    """dict / list を再帰的にたどり、Evidence 形（page と quote を持つ dict）をすべて照合する。"""
    if isinstance(obj, dict):
        if "quote" in obj and "page" in obj:
            return verify_evidence(obj, norm_pages)
        return {k: verify_all(v, norm_pages) for k, v in obj.items()}
    if isinstance(obj, list):
        return [verify_all(v, norm_pages) for v in obj]
    return obj
