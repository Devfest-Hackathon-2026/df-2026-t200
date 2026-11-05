"""API の結合テスト（デモモード。解析ジョブはバックグラウンドスレッドで実際に走る）。"""

import inspect
import json
import threading
import time

import pymupdf
import pytest
from fastapi.testclient import TestClient
from google.genai import errors as genai_errors
from make_sample_pdf import make_pdf

from app import config, main, store
from app.errors import EmptyResponseError


@pytest.fixture
def client(monkeypatch):
    """解析スレッドを記録し、テスト終了時に終わるまで待つ（次のテストへ結果が書き込まれないように）。"""
    threads: list[threading.Thread] = []

    def start(paper_id):
        t = threading.Thread(target=main._run_analysis, args=(paper_id,), daemon=True)
        threads.append(t)
        t.start()

    monkeypatch.setattr(main, "_start", start)
    yield TestClient(main.app)
    for t in threads:
        t.join(timeout=10)


def _upload(client, data, level="undergrad", name="paper.pdf"):
    return client.post("/api/papers", files={"file": (name, data, "application/pdf")}, data={"level": level})


def _wait_done(client, pid, timeout=10.0):
    end = time.time() + timeout
    while time.time() < end:
        p = client.get(f"/api/papers/{pid}").json()
        if p["status"] in ("done", "failed"):
            return p
        time.sleep(0.05)
    raise AssertionError(f"analysis did not finish: {p['status']}")


def test_health_reports_demo_mode(client):
    body = client.get("/api/health").json()
    assert body["ok"] is True
    assert body["demo_mode"] is True
    assert body["max_upload_mb"] == config.MAX_UPLOAD_MB


def test_upload_runs_all_steps_and_verifies_evidence(client, sample_pdf):
    res = _upload(client, sample_pdf)
    assert res.status_code == 200
    pid = res.json()["id"]
    assert res.json()["reused"] is False

    paper = _wait_done(client, pid)
    assert paper["status"] == "done"
    assert paper["error"] is None
    assert set(paper["results"]) == {"step1", "step2", "step3"}
    assert "sha256" not in paper  # 内部情報は返さない
    ev = paper["results"]["step2"]["stages"][0]["evidence"][0]
    assert ev["verified"] is True


def test_same_pdf_is_reused_after_done(client, sample_pdf):
    pid = _upload(client, sample_pdf).json()["id"]
    _wait_done(client, pid)
    again = _upload(client, sample_pdf).json()
    assert again == {"id": pid, "reused": True}
    # レベルが違えば別の解析
    assert _upload(client, sample_pdf, level="grad").json()["id"] != pid


def test_list_papers_includes_uploaded(client, sample_pdf):
    pid = _upload(client, sample_pdf).json()["id"]
    _wait_done(client, pid)
    assert [p["id"] for p in client.get("/api/papers").json()] == [pid]


def test_get_pdf_returns_file(client, sample_pdf):
    pid = _upload(client, sample_pdf).json()["id"]
    res = client.get(f"/api/papers/{pid}/pdf")
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/pdf"
    assert res.content == sample_pdf


@pytest.mark.parametrize("path", ["/api/papers/zzz", "/api/papers/0123456789abcdef", "/api/papers/0123456789abcdef/pdf"])
def test_unknown_or_invalid_id_is_404(client, path):
    assert client.get(path).status_code == 404


def test_upload_rejects_invalid_level(client, sample_pdf):
    assert _upload(client, sample_pdf, level="phd").status_code == 400


def test_upload_rejects_non_pdf(client):
    res = _upload(client, b"hello world", name="a.txt")
    assert res.status_code == 400
    assert "PDF" in res.json()["detail"]


def test_upload_rejects_broken_pdf(client):
    res = _upload(client, b"%PDF-1.7 broken")
    assert res.status_code == 400


def test_upload_rejects_pdf_without_text(client):
    doc = pymupdf.open()
    doc.new_page()
    res = _upload(client, doc.tobytes())
    assert res.status_code == 400
    assert "テキスト" in res.json()["detail"]


def test_upload_rejects_too_many_pages(client, monkeypatch):
    monkeypatch.setattr(config, "MAX_PAGES", 2)
    res = _upload(client, make_pdf(3))
    assert res.status_code == 413


def test_upload_checks_page_count_before_extracting_text(client, monkeypatch):
    def no_extract(*_a, **_k):
        raise AssertionError("本文を抽出する前にページ数で弾くこと")

    monkeypatch.setattr(config, "MAX_PAGES", 2)
    monkeypatch.setattr(pymupdf.Page, "get_text", no_extract)
    res = _upload(client, make_pdf(3))
    assert res.status_code == 413
    assert "3 ページ" in res.json()["detail"]


def test_upload_rejects_too_much_text(client, monkeypatch):
    monkeypatch.setattr(config, "MAX_TOTAL_CHARS", 500)
    res = _upload(client, make_pdf(3))
    assert res.status_code == 413
    assert "テキスト" in res.json()["detail"]


def test_upload_is_sync_so_it_runs_in_threadpool():
    # async def のまま同期処理をすると、処理中はほかのリクエストがすべて止まる
    assert not inspect.iscoroutinefunction(main.upload)


def test_upload_rejects_too_large(client, monkeypatch):
    monkeypatch.setattr(config, "MAX_UPLOAD_MB", 0)
    assert _upload(client, make_pdf(1)).status_code == 413


def test_ask_appends_messages_with_evidence(client, sample_pdf):
    pid = _upload(client, sample_pdf).json()["id"]
    _wait_done(client, pid)
    res = client.post(f"/api/papers/{pid}/ask", json={"question": "この手法の弱点は？", "current_step": 3})
    assert res.status_code == 200
    msgs = res.json()["messages"]
    assert [m["role"] for m in msgs] == ["user", "assistant"]
    assert msgs[1]["source"] in ("paper", "general_knowledge", "not_in_paper")
    assert all("verified" in ev for ev in msgs[1]["evidence"])
    assert len(client.get(f"/api/papers/{pid}").json()["messages"]) == 2


def test_ask_returns_502_with_friendly_message_on_failure(client, sample_pdf, monkeypatch):
    pid = _upload(client, sample_pdf).json()["id"]
    _wait_done(client, pid)

    def boom(*_a, **_k):
        raise _api_error(429, "RESOURCE_EXHAUSTED", "Quota exceeded for project secret-proj-123")

    monkeypatch.setattr(main.mock, "ask", boom)
    res = client.post(f"/api/papers/{pid}/ask", json={"question": "q"})
    assert res.status_code == 502
    assert "レート制限" in res.json()["detail"]
    assert "secret-proj-123" not in res.json()["detail"]


def test_retry_only_allowed_when_failed(client, sample_pdf, monkeypatch):
    pid = _upload(client, sample_pdf).json()["id"]
    _wait_done(client, pid)
    assert client.post(f"/api/papers/{pid}/retry").status_code == 409


def test_failed_analysis_can_be_retried(client, sample_pdf, monkeypatch):
    original = main.mock.step2
    monkeypatch.setattr(main.mock, "step2", lambda *_a: (_ for _ in ()).throw(_api_error(403, "PERMISSION_DENIED", "denied on secret-proj-123")))
    pid = _upload(client, sample_pdf).json()["id"]
    paper = _wait_done(client, pid)
    assert paper["status"] == "failed"
    assert "認証" in paper["error"]
    assert "secret-proj-123" not in paper["error"]
    assert "step1" in paper["results"]  # 失敗前に終わった Step は残る

    monkeypatch.setattr(main.mock, "step2", original)
    assert client.post(f"/api/papers/{pid}/retry").json() == {"ok": True}
    assert _wait_done(client, pid)["status"] == "done"


def _api_error(code, status, message):
    cls = genai_errors.ServerError if code >= 500 else genai_errors.ClientError
    return cls(code, {"error": {"code": code, "message": message, "status": status}})


@pytest.mark.parametrize(
    ("exc", "expected"),
    [
        (_api_error(401, "UNAUTHENTICATED", "API key not valid"), "認証"),
        (_api_error(403, "PERMISSION_DENIED", "denied"), "認証"),
        (_api_error(429, "RESOURCE_EXHAUSTED", "quota"), "レート制限"),
        (_api_error(404, "NOT_FOUND", "models/gemini-x is not found"), "モデルが見つかりません"),
        (_api_error(503, "UNAVAILABLE", "overloaded"), "混み合って"),
        (EmptyResponseError("no text"), "応答"),
        # 文字列に 401 / 403 が含まれていても、google-genai の例外でなければ認証エラーとは扱わない
        (RuntimeError("timeout after 401 ms on secret-proj-123"), "解析中にエラー"),
    ],
)
def test_error_message_is_classified_by_type_and_code(exc, expected):
    msg = main._error_message(exc)
    assert expected in msg
    assert "secret-proj-123" not in msg
    assert str(exc)[:20] not in msg


def test_generic_error_does_not_leak_details(client, sample_pdf, monkeypatch):
    monkeypatch.setattr(main.mock, "step1", lambda *_a: (_ for _ in ()).throw(RuntimeError("Vertex project secret-proj-123 model x")))
    pid = _upload(client, sample_pdf).json()["id"]
    paper = _wait_done(client, pid)
    assert paper["status"] == "failed"
    assert "secret-proj-123" not in paper["error"]


def test_store_is_isolated_per_test():
    assert store.list_papers() == []


def _stuck_paper(pdf, status, updated_at=None):
    """状態を指定した論文を作る。updated_at を渡すと、その時刻に書き換える（止まった解析の再現）。"""
    pid = store.new_id()
    store.save_pdf(pid, pdf)
    store.save(
        {
            "id": pid,
            "filename": "a.pdf",
            "sha256": "x",
            "level": "undergrad",
            "page_count": 3,
            "status": status,
            "error": None,
            "demo": True,
            "results": {},
            "messages": [],
            "created_at": store.now(),
        }
    )
    if updated_at is not None:
        path = config.PAPER_DIR / f"{pid}.json"
        doc = json.loads(path.read_text(encoding="utf-8"))
        path.write_text(json.dumps({**doc, "updated_at": updated_at}), encoding="utf-8")
    return pid


def test_stale_processing_can_be_retried(client, sample_pdf):
    pid = _stuck_paper(sample_pdf, "processing_step2", "2000-01-01T00:00:00+00:00")
    assert client.post(f"/api/papers/{pid}/retry").status_code == 200
    assert _wait_done(client, pid)["status"] == "done"


def test_recent_processing_cannot_be_retried(client, sample_pdf):
    pid = _stuck_paper(sample_pdf, "processing_step2")
    assert client.post(f"/api/papers/{pid}/retry").status_code == 409


def test_double_retry_starts_only_one_job(client, sample_pdf, monkeypatch):
    started = []
    monkeypatch.setattr(main, "_start", started.append)
    pid = _stuck_paper(sample_pdf, "failed")
    codes = [client.post(f"/api/papers/{pid}/retry").status_code for _ in range(2)]
    assert codes == [200, 409]
    assert started == [pid]


def test_analysis_failure_before_first_step_marks_failed(sample_pdf):
    pid = _stuck_paper(sample_pdf, "queued")
    store.pdf_path(pid).unlink()  # PDF の読み込みで失敗させる
    main._run_analysis(pid)
    paper = store.load(pid)
    assert paper["status"] == "failed"
    assert paper["error"]


def test_analysis_of_missing_paper_does_nothing():
    main._run_analysis(store.new_id())  # 例外を出さない
