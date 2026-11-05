"""デモモード用のサンプル解析結果（Gemini の認証情報がないときに使う）。

画面上では「デモモード」と明示する。解説文は汎用のサンプルだが、根拠の引用（quote）は
アップロードされた PDF の実際の文から取るので、根拠チップ → PDF ジャンプ → 強調表示の動作は確認できる。
"""

import re
import time
from typing import Any


def _snippets(pages: list[str]) -> list[tuple[int, str]]:
    out: list[tuple[int, str]] = []
    for i, text in enumerate(pages, start=1):
        flat = re.sub(r"\s+", " ", text)
        for sent in re.split(r"(?<=[.!?])\s+", flat):
            words = sent.split()
            if 10 <= len(words) <= 40 and sum(c.isalpha() for c in sent) > len(sent) * 0.6:
                out.append((i, " ".join(words[:14])))
                break
    return out or [(1, " ".join(re.sub(r"\s+", " ", pages[0] if pages else "").split()[:8]))]


def _ev(snips: list[tuple[int, str]], k: int) -> list[dict[str, Any]]:
    page, quote = snips[k % len(snips)]
    return [{"page": page, "quote": quote}]


def _title(pages: list[str], filename: str) -> str:
    for line in (pages[0] if pages else "").splitlines():
        line = line.strip()
        if len(line) > 15 and not line.lower().startswith(("arxiv", "http", "preprint")):
            return line
    return filename


def step1(pages: list[str], filename: str) -> dict[str, Any]:
    time.sleep(1.0)
    s = _snippets(pages)
    n = len(pages)
    return {
        "title": _title(pages, filename),
        "summary": [
            "【デモ】この論文が扱う問題の要約がここに入ります。",
            "【デモ】提案手法がどう解いたかの要約がここに入ります。",
            "【デモ】実験で何が分かったかの要約がここに入ります。",
        ],
        "difficulty": "中級",
        "concepts": [
            {"id": "linear-algebra", "name": "ベクトルと行列", "description": "【デモ】データを数値の並びとして扱うための基礎。", "why_needed": "手法の入出力が行列で書かれているため。", "first_page": s[0][0], "depends_on": []},
            {"id": "probability", "name": "確率分布", "description": "【デモ】値がどれくらいの確からしさで出るかを表す。", "why_needed": "損失関数が確率で定義されているため。", "first_page": None, "depends_on": []},
            {"id": "softmax", "name": "softmax 関数", "description": "【デモ】数値の並びを確率分布に変換する関数。", "why_needed": "出力層で使われるため。", "first_page": s[1 % len(s)][0], "depends_on": ["linear-algebra", "probability"]},
            {"id": "neural-network", "name": "ニューラルネットワーク", "description": "【デモ】層を重ねて入力から出力を学習するモデル。", "why_needed": "提案手法の土台になっているため。", "first_page": s[0][0], "depends_on": ["linear-algebra"]},
            {"id": "gradient-descent", "name": "勾配降下法", "description": "【デモ】損失を小さくする方向にパラメータを少しずつ動かす学習法。", "why_needed": "学習手順の説明で前提とされているため。", "first_page": None, "depends_on": ["neural-network"]},
            {"id": "attention", "name": "Attention", "description": "【デモ】入力のどこに注目するかを重みで表す仕組み。", "why_needed": "提案手法の中心部品であるため。", "first_page": s[2 % len(s)][0], "depends_on": ["softmax", "neural-network"]},
        ],
        "sections": [
            {"title": "1. Introduction", "page_start": 1, "page_end": min(2, n)},
            {"title": "2. Method", "page_start": min(3, n), "page_end": min(5, n)},
            {"title": "3. Experiments", "page_start": min(6, n), "page_end": n},
        ],
        "reading_order": [
            {"section": "Abstract", "page": 1, "reason": "【デモ】まず全体の主張をつかむ。"},
            {"section": "Figure 1 とその説明", "page": min(2, n), "reason": "【デモ】手法の全体像を図で先に見る。"},
            {"section": "2. Method", "page": min(3, n), "reason": "【デモ】前提知識マップを見ながら手法を追う。"},
            {"section": "3. Experiments", "page": min(6, n), "reason": "【デモ】主張が実験でどう支えられているかを確かめる。"},
        ],
    }


def step2(pages: list[str]) -> dict[str, Any]:
    time.sleep(1.5)
    s = _snippets(pages)
    p = lambda k: s[k % len(s)][0]  # noqa: E731
    return {
        "overview": "【デモ】提案手法は入力を埋め込みに変換し、Attention で関係を計算して出力を得る。",
        "stages": [
            {
                "title": "入力の表現",
                "explanation": "【デモ】入力データをベクトルに変換する段階の説明がここに入ります。",
                "evidence": _ev(s, 0),
                "figures": [
                    {"label": "Figure 1", "page": p(1), "what_it_shows": "【デモ】手法の全体構成。", "how_to_read": "【デモ】左から右へデータが流れる。", "supports_claim": "【デモ】提案手法の構成を示す。", "referenced_at": _ev(s, 1)}
                ],
                "equations": [],
            },
            {
                "title": "Attention の計算",
                "explanation": "【デモ】入力どうしの関係を重みとして計算する段階の説明がここに入ります。",
                "evidence": _ev(s, 2),
                "figures": [],
                "equations": [
                    {
                        "label": "(1)",
                        "page": p(2),
                        "latex": r"\mathrm{Attention}(Q,K,V)=\mathrm{softmax}\left(\frac{QK^\top}{\sqrt{d_k}}\right)V",
                        "plain_meaning": "【デモ】クエリとキーの類似度で値を重み付き平均する。",
                        "symbols": [
                            {"symbol_latex": "Q", "meaning": "クエリ行列", "defined_page": p(2)},
                            {"symbol_latex": "K", "meaning": "キー行列", "defined_page": p(2)},
                            {"symbol_latex": "d_k", "meaning": "キーの次元数", "defined_page": None},
                        ],
                    }
                ],
            },
            {
                "title": "実験による検証",
                "explanation": "【デモ】ベースラインと比較した結果の説明がここに入ります。",
                "evidence": _ev(s, 3),
                "figures": [
                    {"label": "Table 1", "page": p(3), "what_it_shows": "【デモ】既存手法との性能比較。", "how_to_read": "【デモ】太字が各列の最高値。", "supports_claim": "【デモ】提案手法が既存手法を上回ること。", "referenced_at": _ev(s, 3)}
                ],
                "equations": [],
            },
        ],
    }


def step3(pages: list[str]) -> dict[str, Any]:
    time.sleep(1.0)
    s = _snippets(pages)
    return {
        "prompts": [
            "この論文の実験設定で、主張は十分に支えられていると思いますか？",
            "提案手法が苦手そうな入力はどんなものだと思いますか？",
        ],
        "pros": [{"text": "【デモ】論文自身が主張する長所がここに入ります。", "origin": "paper", "evidence": _ev(s, 0)}],
        "cons": [{"text": "【デモ】AI が推論した短所がここに入ります（要検証）。", "origin": "ai_inference", "evidence": _ev(s, 2)}],
        "limitations": [
            {"text": "【デモ】論文が Limitations で認めている限界がここに入ります。", "origin": "paper", "evidence": _ev(s, 4)},
            {"text": "【デモ】AI が指摘する追加の限界がここに入ります（要検証）。", "origin": "ai_inference", "evidence": []},
        ],
        "alternatives": [
            {"name": "【デモ】代替アプローチA", "description": "【デモ】同じ課題への別の解き方。", "comparison": "【デモ】計算量は小さいが精度は劣る。", "origin": "ai_inference", "evidence": []}
        ],
        "likely_questions": [
            {"question": "なぜこの評価指標を選んだのですか？", "hint": "Experiments 節の冒頭で評価設定を確認する。"},
            {"question": "既存手法との一番の違いは何ですか？", "hint": "Introduction の最後の段落（貢献のまとめ）を見る。"},
        ],
    }


def ask(pages: list[str], question: str) -> dict[str, Any]:
    time.sleep(0.6)
    s = _snippets(pages)
    return {
        "answer": f"【デモモード】「{question}」への回答は、Gemini の認証情報を設定すると論文に基づいて生成されます。下の根拠チップで PDF へのジャンプを試せます。",
        "source": "paper",
        "evidence": _ev(s, 1),
        "confidence": "low",
    }
