"""確認モードの純粋なロジック（Gemini の出力の検証、問題の組み立て、採点、公開用の見た目）。

1概念1問の4択。選択肢のうち3つは Gemini が作り、4つ目の「分からない」はサーバーが必ず最後に足す。
正解の番号と解説は論文の記録の check に置き、回答する前は public_view で問題文と選択肢だけを返す。
"""

import random
import secrets
import unicodedata
from typing import Any

from pydantic import ValidationError

from .pdf_utils import MIN_QUOTE_CHARS, normalize
from .schemas import CheckAnswer, CheckQuestions

MAX_CONCEPTS = 6
CHOICES = 3
DONT_KNOW = "分からない"
DONT_KNOW_INDEX = CHOICES  # 「分からない」は最後の選択肢
MAX_CHOICE_CHARS = 300
MAX_QUESTION_CHARS = 400
MAX_EXPLANATION_CHARS = 800


class CheckInvalid(ValueError):
    """Gemini が返した問題が使えない（選択肢の重複、正解の番号が範囲外、引用が無いなど）。"""


def _key(text: str) -> str:
    """選択肢の重複判定用。全角半角をそろえ、記号と空白を除いて小文字にする。"""
    return "".join(ch for ch in unicodedata.normalize("NFKC", text).lower() if ch.isalnum())


_DONT_KNOW_KEYS = frozenset({_key(DONT_KNOW), _key("わからない"), _key("don't know"), _key("i don't know"), _key("不明")})


def _clean(text: str) -> str:
    return " ".join(text.split())


def validate_questions(payload: Any, targets: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Gemini の出力をスキーマで検証し、渡した概念すべてに使える問題があるかを確かめる。concept_id → 問題。

    確かめること: id の過不足と重複、選択肢がちょうど3つで互いに別（正規化して比べる）かつ「分からない」でない、
    正解の番号が範囲内、解説がある、論文の概念（origin=paper）には引用がある。
    論文に出てこない概念（ai_inference）の引用は捨てる（論文に書いてあるかのように見せないため）。
    """
    try:
        questions = CheckQuestions.model_validate(payload).questions
    except ValidationError as e:
        raise CheckInvalid("schema") from e
    by_id = {t["id"]: t for t in targets}
    out: dict[str, dict[str, Any]] = {}
    for q in questions:
        target = by_id.get(q.concept_id)
        if target is None or q.concept_id in out:
            raise CheckInvalid("unknown or duplicate concept")
        question, explanation = _clean(q.question), _clean(q.explanation)
        if not question or len(question) > MAX_QUESTION_CHARS or not explanation or len(explanation) > MAX_EXPLANATION_CHARS:
            raise CheckInvalid("empty or too long text")
        choices = [_clean(c) for c in q.choices]
        if len(choices) != CHOICES or any(not c or len(c) > MAX_CHOICE_CHARS for c in choices):
            raise CheckInvalid("choices")
        keys = [_key(c) for c in choices]
        if "" in keys or len(set(keys)) != CHOICES or set(keys) & _DONT_KNOW_KEYS:
            raise CheckInvalid("duplicate or dont-know choice")
        if not 0 <= q.correct_index < CHOICES:
            raise CheckInvalid("correct_index")
        evidence = None
        if target.get("origin") == "paper":
            first = q.evidence[0] if q.evidence else None
            if first is None or len(normalize(first.quote)) < MIN_QUOTE_CHARS:
                raise CheckInvalid("evidence is required for a concept in the paper")
            evidence = {"page": first.page, "quote": _clean(first.quote)}
        out[q.concept_id] = {
            "question": question,
            "choices": choices,
            "correct_index": q.correct_index,
            "explanation": explanation,
            "evidence": evidence,
        }
    if set(out) != set(by_id):
        raise CheckInvalid("missing")
    return out


def build(targets: list[dict[str, Any]], questions: dict[str, dict[str, Any]], rng: random.Random, seq: int, now: str) -> dict[str, Any]:
    """答えを含む問題の記録。選択肢は並べ替えて正解の位置を偏らせず、「分からない」を最後に足す。"""
    items = []
    for n, t in enumerate(targets, start=1):
        q = questions[t["id"]]
        order = list(range(CHOICES))
        rng.shuffle(order)
        items.append(
            {
                "id": f"q{n}",
                "concept_id": t["id"],
                "question": q["question"],
                "options": [q["choices"][i] for i in order] + [DONT_KNOW],
                "correct_index": order.index(q["correct_index"]),
                "explanation": q["explanation"],
                "evidence": q["evidence"],
                "general_knowledge": t.get("origin") != "paper",
            }
        )
    return {"id": secrets.token_hex(8), "seq": seq, "created_at": now, "items": items, "submitted_at": None, "result": None}


def score(c: dict[str, Any], answers: list[CheckAnswer]) -> dict[str, Any]:
    """採点する。answers は呼び出し側で全問分そろっていると検証済みとする。正解なら known、それ以外は unknown。"""
    chosen = {a.id: a.choice for a in answers}
    items = []
    for it in c["items"]:
        choice = chosen[it["id"]]
        items.append(
            {
                "id": it["id"],
                "concept_id": it["concept_id"],
                "question": it["question"],
                "options": it["options"],
                "chosen": choice,
                "correct_index": it["correct_index"],
                "is_correct": choice == it["correct_index"],
                "dont_know": choice == DONT_KNOW_INDEX,
                "explanation": it["explanation"],
                "evidence": it["evidence"],
                "general_knowledge": it["general_knowledge"],
            }
        )
    return {
        "correct": sum(1 for i in items if i["is_correct"]),
        "verdicts": {i["concept_id"]: "known" if i["is_correct"] else "unknown" for i in items},
        "items": items,
    }


def public_view(c: dict[str, Any]) -> dict[str, Any]:
    """ブラウザに返す形。回答前は問題文と選択肢だけ（正解・解説・引用は含めない）。回答後は採点結果を付ける。"""
    return {
        "id": c["id"],
        "created_at": c["created_at"],
        "submitted": c.get("submitted_at") is not None,
        "items": [
            {
                "id": i["id"],
                "concept_id": i["concept_id"],
                "question": i["question"],
                "options": i["options"],
                "general_knowledge": i["general_knowledge"],
            }
            for i in c["items"]
        ],
        "result": c.get("result"),
    }
