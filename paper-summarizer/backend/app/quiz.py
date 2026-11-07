"""誤り探しモードの純粋なロジック（候補の選び方、Gemini の出力の検証、問題の組み立て、採点、公開用の見た目）。

誤りは、引用の照合で verified になった Step 2 / Step 3 の項目からだけ作る。
答え（どの文が変えた文か、元の文、根拠）は論文の記録の quiz に置き、回答する前は public_view で id と文だけを返す。
"""

import random
import re
import secrets
from typing import Any

from pydantic import ValidationError

from .pdf_utils import normalize
from .schemas import QuizPick, QuizRewrites

QUIZ_SIZE = 5
MIN_SENTENCES = 3
MIN_SENTENCE_CHARS = 12
MAX_SENTENCE_CHARS = 300


class QuizInvalid(ValueError):
    """Gemini が返した書き換えが使えない（元の文と同じ、id の過不足、長すぎるなど）。"""


_SPLIT = re.compile(r"(?<=[。！？])|(?<=[.!?])\s+")


def split_sentences(text: str) -> list[str]:
    parts = [p.strip() for p in _SPLIT.split(text or "")]
    return [p for p in parts if MIN_SENTENCE_CHARS <= len(p) <= MAX_SENTENCE_CHARS]


def _first_verified(evidence: Any) -> dict[str, Any] | None:
    for ev in evidence or []:
        if isinstance(ev, dict) and ev.get("verified") is True and ev.get("quote") and isinstance(ev.get("page"), int):
            return ev
    return None


def _sources(results: dict[str, Any]) -> list[tuple[str, str, Any]]:
    """(出どころ, 文章, 根拠) の一覧。Step 2 は段階の説明、Step 3 は論文自身の記述（origin=paper）だけ。"""
    out: list[tuple[str, str, Any]] = []
    for i, stage in enumerate(((results.get("step2") or {}).get("stages")) or []):
        out.append((f"step2:{i}", stage.get("explanation") or "", stage.get("evidence")))
    step3 = results.get("step3") or {}
    for key, text_key in (("pros", "text"), ("cons", "text"), ("limitations", "text"), ("alternatives", "description")):
        for i, point in enumerate(step3.get(key) or []):
            if point.get("origin") == "paper":
                out.append((f"step3:{key}:{i}", point.get(text_key) or "", point.get("evidence")))
    return out


def candidates(results: dict[str, Any], rng: random.Random) -> list[dict[str, Any]]:
    """誤りの元にできる文。出どころ1つにつき1文だけ選び（同じ段落から偏らない）、その出どころの照合済みの根拠を付ける。"""
    out = []
    for source, text, evidence in _sources(results):
        ev = _first_verified(evidence)
        sentences = split_sentences(text)
        if ev is None or not sentences:
            continue
        out.append({"source": source, "text": rng.choice(sentences), "page": ev["page"], "quote": ev["quote"]})
    return out


def validate_rewrites(payload: Any, targets: list[dict[str, Any]]) -> dict[str, dict[str, str]]:
    """Gemini の出力をスキーマで検証し、渡した文すべてに対して使える書き換えがあるかを確かめる。id → {altered, changed}。"""
    try:
        rewrites = QuizRewrites.model_validate(payload).rewrites
    except ValidationError as e:
        raise QuizInvalid("schema") from e
    originals = {t["id"]: t["text"] for t in targets}
    out: dict[str, dict[str, str]] = {}
    for rw in rewrites:
        original = originals.get(rw.id)
        altered = " ".join(rw.altered.split())
        if original is None or rw.id in out or not altered:
            raise QuizInvalid("unknown, duplicate or empty")
        if normalize(altered) == normalize(original):
            raise QuizInvalid("not changed")
        if len(altered) > 2 * len(original) + 80:
            raise QuizInvalid("too long")
        out[rw.id] = {"altered": altered, "changed": " ".join(rw.changed.split())[:300]}
    if set(out) != set(originals):
        raise QuizInvalid("missing")
    return out


def choose(pool: list[dict[str, Any]], rng: random.Random) -> tuple[list[dict[str, Any]], int]:
    """問題にする文（最大5）と、そのうち誤りにする数（1〜2。文が少ないときは1）を決める。cN の id を付ける。"""
    picked = rng.sample(pool, min(QUIZ_SIZE, len(pool)))
    picked = [{**c, "id": f"c{i + 1}"} for i, c in enumerate(picked)]
    n_wrong = 1 if len(picked) < 4 else rng.choice([1, 2])
    return picked, n_wrong


def build(
    picked: list[dict[str, Any]], wrong_ids: set[str], rewrites: dict[str, dict[str, str]], rng: random.Random, seq: int, now: str
) -> dict[str, Any]:
    """答えを含む問題の記録。文はここで並べ替えて q1, q2, ... の id を振り直す（元の並びから答えが分からないように）。"""
    order = picked[:]
    rng.shuffle(order)
    items = []
    for n, c in enumerate(order, start=1):
        is_wrong = c["id"] in wrong_ids
        items.append(
            {
                "id": f"q{n}",
                "text": rewrites[c["id"]]["altered"] if is_wrong else c["text"],
                "altered": is_wrong,
                "original": c["text"],
                "changed": rewrites[c["id"]]["changed"] if is_wrong else None,
                "evidence": {"page": c["page"], "quote": c["quote"], "verified": True},
                "source": c["source"],
            }
        )
    return {"id": secrets.token_hex(8), "seq": seq, "created_at": now, "items": items, "submitted_at": None, "result": None}


def score(q: dict[str, Any], picks: list[QuizPick]) -> dict[str, Any]:
    """回答を採点する。picks の id は呼び出し側で検証済みとする。"""
    chosen = {p.id: p.page for p in picks}
    items = []
    for it in q["items"]:
        selected = it["id"] in chosen
        page = chosen.get(it["id"])
        items.append(
            {
                "id": it["id"],
                "text": it["text"],
                "selected": selected,
                "user_page": page,
                "altered": it["altered"],
                "page_ok": (page == it["evidence"]["page"]) if selected and it["altered"] else None,
                "original": it["original"] if it["altered"] else None,
                "changed": it["changed"],
                "evidence": it["evidence"] if it["altered"] else None,
            }
        )
    wrong = [i for i in items if i["altered"]]
    found = sum(1 for i in wrong if i["selected"])
    return {
        "found": found,
        "false_alarms": sum(1 for i in items if i["selected"] and not i["altered"]),
        "missed": len(wrong) - found,
        "total_errors": len(wrong),
        "items": items,
    }


def public_view(q: dict[str, Any]) -> dict[str, Any]:
    """ブラウザに返す形。回答前は id と文だけ（答えは含めない）。回答後は採点結果を付ける。"""
    return {
        "id": q["id"],
        "created_at": q["created_at"],
        "submitted": q.get("submitted_at") is not None,
        "items": [{"id": i["id"], "text": i["text"]} for i in q["items"]],
        "result": q.get("result"),
    }
