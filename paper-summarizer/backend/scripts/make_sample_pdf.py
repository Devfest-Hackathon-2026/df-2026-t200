"""テスト・e2e 用のサンプル論文 PDF を作る（実在の論文ではなく、テスト用に書いた英文）。

使い方: uv run python scripts/make_sample_pdf.py <出力先.pdf> [ページ数]
"""

import sys
from pathlib import Path

import pymupdf

PARAGRAPHS = [
    "We study how attention mechanisms help students read long scientific documents in a structured way.",
    "Our method splits the reading process into three stages that build prerequisite knowledge step by step.",
    "As shown in Figure 1, the proposed pipeline connects each explanation to the exact page of the source text.",
    "The experiments indicate that grounded explanations reduce the time needed to understand the main claims.",
    "We discuss the limitations of the approach and outline several alternative designs for future work.",
]


def make_pdf(pages: int = 3, paragraphs: list[str] | None = None) -> bytes:
    """1ページあたり数文の英文を含む PDF を返す。各ページの文はページ番号付きで一意になる。"""
    paras = paragraphs or PARAGRAPHS
    doc = pymupdf.open()
    for i in range(pages):
        page = doc.new_page()
        lines = [f"Sample Paper for Automated Tests - Section {i + 1}"]
        lines += [f"{p} This sentence belongs to page {i + 1} of the sample." for p in paras]
        page.insert_textbox(pymupdf.Rect(50, 50, 550, 800), "\n\n".join(lines), fontsize=11)
    data = doc.tobytes()
    doc.close()
    return data


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: make_sample_pdf.py <out.pdf> [pages]")
    out = Path(sys.argv[1])
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(make_pdf(int(sys.argv[2]) if len(sys.argv) > 2 else 3))
    print(out)
