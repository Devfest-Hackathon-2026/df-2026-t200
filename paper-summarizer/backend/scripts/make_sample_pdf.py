"""テスト・e2e 用のサンプル論文 PDF を作る（実在の論文ではなく、テスト用に書いた英文）。

PDF ライブラリを使わず、標準フォント（Helvetica）だけの最小の PDF を直接書き出す。

使い方: uv run python scripts/make_sample_pdf.py <出力先.pdf> [ページ数]
"""

import sys
import textwrap
from pathlib import Path

PARAGRAPHS = [
    "We study how attention mechanisms help students read long scientific documents in a structured way.",
    "Our method splits the reading process into three stages that build prerequisite knowledge step by step.",
    "As shown in Figure 1, the proposed pipeline connects each explanation to the exact page of the source text.",
    "The experiments indicate that grounded explanations reduce the time needed to understand the main claims.",
    "We discuss the limitations of the approach and outline several alternative designs for future work.",
]

PAGE_WIDTH, PAGE_HEIGHT = 595, 842  # A4（pt）
MARGIN = 50
FONT_SIZE = 11
LEADING = 14
WRAP_CHARS = 90  # Helvetica 11pt で本文幅（約 495pt）に収まる文字数


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _content(lines: list[str]) -> bytes:
    ops = [f"BT /F1 {FONT_SIZE} Tf {LEADING} TL {MARGIN} {PAGE_HEIGHT - MARGIN - FONT_SIZE} Td"]
    ops += [f"({_escape(line)}) Tj T*" for line in lines]
    ops.append("ET")
    return "\n".join(ops).encode("latin-1")


def build_pdf(pages: list[list[str]]) -> bytes:
    """ページごとの行のリストから PDF を作る。行は折り返さずにそのまま1行ずつ置く（空のリストなら白紙のページ）。"""
    n = len(pages)
    # オブジェクト番号: 1 カタログ, 2 ページツリー, 3 フォント, 以降ページごとに (ページ, 内容)
    page_ids = [4 + 2 * i for i in range(n)]
    objects: list[bytes] = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        f"<< /Type /Pages /Kids [{' '.join(f'{p} 0 R' for p in page_ids)}] /Count {n} >>".encode(),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    ]
    for pid, lines in zip(page_ids, pages, strict=True):
        stream = _content(lines)
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_WIDTH} {PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R >> >> /Contents {pid + 1} 0 R >>".encode()
        )
        objects.append(f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream")

    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    out += "".join(f"{o:010d} 00000 n \n" for o in offsets).encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def make_pdf(pages: int = 3, paragraphs: list[str] | None = None) -> bytes:
    """1ページあたり数文の英文を含む PDF を返す。各ページの文はページ番号付きで一意になる。"""
    paras = paragraphs or PARAGRAPHS
    content = []
    for i in range(pages):
        lines = [f"Sample Paper for Automated Tests - Section {i + 1}", ""]
        for p in paras:
            lines += textwrap.wrap(f"{p} This sentence belongs to page {i + 1} of the sample.", WRAP_CHARS, break_on_hyphens=False)
            lines.append("")
        content.append(lines)
    return build_pdf(content)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: make_sample_pdf.py <out.pdf> [pages]")
    out = Path(sys.argv[1])
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(make_pdf(int(sys.argv[2]) if len(sys.argv) > 2 else 3))
    print(out)
