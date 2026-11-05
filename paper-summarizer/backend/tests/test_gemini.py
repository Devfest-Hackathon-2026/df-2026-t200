"""Gemini 呼び出しのテスト。実 API は呼ばず、クライアントを差し替えてプロンプト組み立てとスキーマ検証を確かめる。

デモモードのサンプル結果（mock）を Gemini の応答として返すので、mock がスキーマに合っていることも同時に確かめられる。
"""

import json
from types import SimpleNamespace

import pytest

from app import config, gemini, mock


class FakeModels:
    def __init__(self, payload):
        self.payload = payload
        self.calls = []

    def generate_content(self, model, contents, config):
        self.calls.append({"model": model, "contents": contents, "config": config})
        return SimpleNamespace(parsed=None, text=json.dumps(self.payload))


@pytest.fixture
def fake(monkeypatch):
    def install(payload):
        models = FakeModels(payload)
        monkeypatch.setattr(gemini, "client", lambda: SimpleNamespace(models=models))
        return models

    return install


PAGES = ["This is the first page of a sample paper about attention and reading support. " * 3, "Second page text with results. " * 5]


def test_step1_validates_schema_and_uses_analysis_model(fake):
    models = fake(mock.step1(PAGES, "a.pdf"))
    out = gemini.step1(b"%PDF", "grad")
    assert len(out["summary"]) == 3
    call = models.calls[0]
    assert call["model"] == config.ANALYSIS_MODEL
    assert call["config"].response_mime_type == "application/json"
    assert "修士課程" in call["config"].system_instruction


def test_step2_and_step3_include_step1_context(fake):
    s1 = mock.step1(PAGES, "a.pdf")
    models = fake(mock.step2(PAGES))
    gemini.step2(b"%PDF", "undergrad", s1)
    assert s1["title"] in models.calls[0]["contents"][1]

    models = fake(mock.step3(PAGES))
    out = gemini.step3(b"%PDF", "undergrad", s1)
    assert out["pros"]
    assert s1["title"] in models.calls[0]["contents"][1]


def test_ask_includes_history_and_current_step(fake):
    models = fake(mock.ask(PAGES, "q"))
    history = [{"role": "user", "text": "前の質問"}, {"role": "assistant", "text": "前の回答"}]
    out = gemini.ask(b"%PDF", "undergrad", "新しい質問", history, 2)
    prompt = models.calls[0]["contents"][1]
    assert "前の質問" in prompt and "新しい質問" in prompt and "Step 2" in prompt
    assert models.calls[0]["model"] == config.QA_MODEL
    assert out["source"] in ("paper", "general_knowledge", "not_in_paper")


def test_generate_prefers_parsed_response(monkeypatch):
    parsed = SimpleNamespace(model_dump=lambda mode: {"from": "parsed"})
    resp = SimpleNamespace(parsed=parsed, text="ignored")
    monkeypatch.setattr(gemini, "client", lambda: SimpleNamespace(models=SimpleNamespace(generate_content=lambda **_k: resp)))
    assert gemini._generate("m", [], gemini.Answer, "undergrad") == {"from": "parsed"}


@pytest.mark.parametrize(("project", "expected"), [("my-proj", {"vertexai": True, "project": "my-proj"}), ("", {"api_key": "k"})])
def test_client_selects_vertex_or_api_key(monkeypatch, project, expected):
    created = {}
    monkeypatch.setattr(gemini, "_client", None)
    monkeypatch.setattr(config, "GOOGLE_CLOUD_PROJECT", project)
    monkeypatch.setattr(config, "GEMINI_API_KEY", "k")
    monkeypatch.setattr(gemini.genai, "Client", lambda **kw: created.update(kw) or "client")
    assert gemini.client() == "client"
    assert expected.items() <= created.items()
    assert gemini.client() == "client"  # 2回目はキャッシュを使う
