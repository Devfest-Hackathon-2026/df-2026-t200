"""公開デプロイで Gemini の費用が際限なく増えないための上限と、一覧の持ち主での絞り込みのテスト。"""

import threading
import time

import pytest
from fastapi.testclient import TestClient
from make_sample_pdf import make_pdf

from app import main, store
from app.quota import DailyQuota
from app.ratelimit import RateLimiter
from app.services import PaperService

CID_A = "client-aaaaaaaaaaaaaaaa"
CID_B = "client-bbbbbbbbbbbbbbbb"


# ---------- DailyQuota ----------


def test_quota_allows_up_to_the_limit(tmp_path):
    q = DailyQuota("t", 2, directory=tmp_path)
    assert [q.take(), q.take(), q.take()] == [True, True, False]


def test_quota_survives_a_restart(tmp_path):
    """インスタンスが入れ替わっても（新しいオブジェクトでも）数は0に戻らない。"""
    assert DailyQuota("t", 1, directory=tmp_path).take() is True
    assert DailyQuota("t", 1, directory=tmp_path).take() is False


def test_quota_forgets_entries_older_than_the_window(tmp_path):
    now = [1000.0]
    q = DailyQuota("t", 1, directory=tmp_path, window_sec=60, clock=lambda: now[0])
    assert q.take() is True
    assert q.take() is False
    now[0] += 61
    assert q.take() is True


def test_quota_zero_blocks_everything(tmp_path):
    """0 にすると緊急停止になる。"""
    assert DailyQuota("t", 0, directory=tmp_path).take() is False


def test_quota_tolerates_a_broken_file(tmp_path):
    (tmp_path / "t.json").write_text("{broken", encoding="utf-8")
    assert DailyQuota("t", 1, directory=tmp_path).take() is True


# ---------- API ----------


@pytest.fixture
def service(tmp_path):
    threads: list[threading.Thread] = []

    def start(paper_id):
        t = threading.Thread(target=svc.run_analysis, args=(paper_id,), daemon=True)
        threads.append(t)
        t.start()

    svc = PaperService(starter=start)
    svc.upload_quota = DailyQuota("uploads", 100, directory=tmp_path)
    svc.analysis_quota = DailyQuota("analyses", 100, directory=tmp_path)
    svc.ask_quota = DailyQuota("asks", 100, directory=tmp_path)
    yield svc
    for t in threads:
        t.join(timeout=10)


@pytest.fixture
def client(service):
    main.app.dependency_overrides[main.get_service] = lambda: service
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


def _upload(client, data, cid=CID_A, level="undergrad"):
    headers = {"X-Client-Id": cid} if cid else {}
    return client.post("/api/papers", files={"file": ("p.pdf", data, "application/pdf")}, data={"level": level}, headers=headers)


def _wait_done(client, pid, timeout=10.0):
    end = time.time() + timeout
    while time.time() < end:
        p = client.get(f"/api/papers/{pid}").json()
        if p["status"] in ("done", "failed"):
            return p
        time.sleep(0.05)
    raise AssertionError("analysis did not finish")


def test_upload_is_refused_when_the_daily_analysis_limit_is_reached(client, service, tmp_path):
    service.analysis_quota = DailyQuota("analyses", 0, directory=tmp_path)
    res = _upload(client, make_pdf(3))
    assert res.status_code == 429
    assert "上限" in res.json()["detail"]
    assert store.list_papers(store.owner_of(CID_A)) == []


def test_upload_is_refused_when_the_daily_upload_limit_is_reached(client, service, tmp_path):
    service.upload_quota = DailyQuota("uploads", 0, directory=tmp_path)
    assert _upload(client, make_pdf(3)).status_code == 429


def test_reusing_an_analysed_pdf_does_not_use_the_analysis_limit(client, service, tmp_path):
    service.analysis_quota = DailyQuota("analyses", 1, directory=tmp_path)
    pdf = make_pdf(3)
    first = _upload(client, pdf).json()
    _wait_done(client, first["id"])
    second = _upload(client, pdf)
    assert second.status_code == 200
    assert second.json()["reused"] is True


def test_retry_uses_the_analysis_limit(client, service, tmp_path):
    pid = _upload(client, make_pdf(3)).json()["id"]
    _wait_done(client, pid)
    store.update(pid, status="failed", error="x")
    service.analysis_quota = DailyQuota("analyses", 0, directory=tmp_path)
    assert client.post(f"/api/papers/{pid}/retry").status_code == 429
    assert store.load(pid)["status"] == "failed"


def test_ask_is_refused_over_the_daily_limit(client, service, tmp_path):
    pid = _upload(client, make_pdf(3)).json()["id"]
    _wait_done(client, pid)
    service.ask_quota = DailyQuota("asks", 0, directory=tmp_path)
    res = client.post(f"/api/papers/{pid}/ask", json={"question": "何の論文？"})
    assert res.status_code == 429


def test_ask_limit_per_minute_is_shared_by_all_papers(client, service):
    """論文IDを変えても、全体の1分あたりの上限は回避できない。"""
    ids = [_upload(client, make_pdf(n)).json()["id"] for n in (3, 4)]
    for pid in ids:
        _wait_done(client, pid)
    service.ask_global_limiter = RateLimiter(1, 60)
    assert client.post(f"/api/papers/{ids[0]}/ask", json={"question": "q"}).status_code == 200
    assert client.post(f"/api/papers/{ids[1]}/ask", json={"question": "q"}).status_code == 429


def test_list_shows_only_papers_uploaded_from_the_same_browser(client):
    mine = _upload(client, make_pdf(3), cid=CID_A).json()["id"]
    _upload(client, make_pdf(4), cid=CID_B)
    _upload(client, make_pdf(5), cid=None)
    assert [p["id"] for p in client.get("/api/papers", headers={"X-Client-Id": CID_A}).json()] == [mine]
    assert client.get("/api/papers").json() == []
    assert client.get("/api/papers", headers={"X-Client-Id": "short"}).json() == []


def test_owner_is_not_exposed(client):
    pid = _upload(client, make_pdf(3)).json()["id"]
    body = client.get(f"/api/papers/{pid}").json()
    assert "owner" not in body
    assert "sha256" not in body


def test_upload_returns_503_when_too_many_uploads_are_being_processed(client, monkeypatch):
    monkeypatch.setattr(main, "_upload_slots", threading.BoundedSemaphore(1))
    main._upload_slots.acquire()
    try:
        res = _upload(client, make_pdf(3))
    finally:
        main._upload_slots.release()
    assert res.status_code == 503
