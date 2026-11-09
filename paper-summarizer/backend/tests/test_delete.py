"""論文の削除（DELETE /api/papers/{id} と store.delete_paper）。"""

import threading
import time

import pytest
from fastapi.testclient import TestClient

from app import config, main, mock, store
from app.ratelimit import RateLimiter
from app.services import PaperService

OWNER = "o" * 32
CLIENT = {"X-Client-Id": "test-client-0000000001"}
OTHER = {"X-Client-Id": "other-client-000000002"}


def _paper(pid, **kw):
    base = {
        "id": pid,
        "filename": "a.pdf",
        "status": "queued",
        "created_at": store.now(),
        "results": {},
        "owner": OWNER,
        "analysis_version": config.ANALYSIS_VERSION,
    }
    return {**base, **kw}


def _files(pid):
    return [store._json_path(pid), store.pdf_path(pid), store.pages_path(pid)]


def _seed(pid, **kw):
    store.save(_paper(pid, **kw))
    store.save_pdf(pid, b"%PDF-x")
    store.save_pages(pid, ["a"], ["a"])


# ---------- store ----------


def test_delete_paper_removes_record_pdf_and_page_cache():
    pid = "a" * 16
    _seed(pid)
    assert store.delete_paper(pid, OWNER) is True
    assert not any(p.exists() for p in _files(pid))
    assert store.load(pid) is None


def test_delete_paper_refuses_other_owner_missing_owner_and_bad_id():
    pid = "b" * 16
    _seed(pid)
    assert store.delete_paper(pid, "x" * 32) is False
    assert store.delete_paper(pid, None) is False
    assert all(p.exists() for p in _files(pid))
    _seed("c" * 16, owner=None)  # owner の無い古い記録は誰も消せない
    assert store.delete_paper("c" * 16, None) is False
    assert store.delete_paper("../../etc/passwd", OWNER) is False
    assert store.delete_paper("d" * 16, OWNER) is False  # 無い


def test_delete_paper_keeps_other_papers_with_the_same_pdf():
    _seed("a" * 16, sha256="h", level="undergrad", status="done")
    _seed("b" * 16, sha256="h", level="undergrad", status="done", owner="y" * 32)
    store.delete_paper("a" * 16, OWNER)
    assert store.find_by_hash("h", "undergrad") == "b" * 16
    assert all(p.exists() for p in _files("b" * 16))


def test_delete_paper_removes_the_record_last_so_a_failure_can_be_retried(monkeypatch):
    pid = "f" * 16
    _seed(pid)
    real = type(store.pages_path(pid)).unlink

    def flaky(self, *a, **k):
        if self.name.endswith(".pages.json"):
            raise OSError("disk error")  # PDF は消えたあと、ページのキャッシュで失敗
        return real(self, *a, **k)

    monkeypatch.setattr(type(store.pages_path(pid)), "unlink", flaky)
    with pytest.raises(OSError):
        store.delete_paper(pid, OWNER)
    assert store._json_path(pid).exists()  # 記録が残るので、画面の一覧にも出て再試行できる
    monkeypatch.undo()
    assert store.delete_paper(pid, OWNER) is True
    assert not any(p.exists() for p in _files(pid))


def test_deleted_record_is_not_recreated_by_late_writes():
    pid = "e" * 16
    _seed(pid)
    store.delete_paper(pid, OWNER)
    with pytest.raises(KeyError):
        store.update(pid, status="failed")
    with pytest.raises(KeyError):
        store.transition(pid, lambda p: True, status="done")
    assert not store._json_path(pid).exists()


# ---------- API ----------


@pytest.fixture
def service():
    threads: list[threading.Thread] = []

    def start(paper_id):
        t = threading.Thread(target=svc.run_analysis, args=(paper_id,), daemon=True)
        threads.append(t)
        t.start()

    svc = PaperService(starter=start)
    yield svc
    for t in threads:
        t.join(timeout=10)


@pytest.fixture
def client(service):
    main.app.dependency_overrides[main.get_service] = lambda: service
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


def _upload(client, data, headers=CLIENT):
    return client.post("/api/papers", files={"file": ("p.pdf", data, "application/pdf")}, data={"level": "undergrad"}, headers=headers)


def _wait_done(client, pid, timeout=10.0):
    end = time.time() + timeout
    while time.time() < end:
        if client.get(f"/api/papers/{pid}").json()["status"] in ("done", "failed"):
            return
        time.sleep(0.05)
    raise AssertionError("analysis did not finish")


def _hold_step1(monkeypatch):
    gate = threading.Event()
    original = mock.step1
    monkeypatch.setattr(mock, "step1", lambda *a: (gate.wait(5), original(*a))[1])
    return gate


def _wait_idle(service):
    end = time.time() + 5
    while service._running and time.time() < end:
        time.sleep(0.02)
    assert not service._running


def test_delete_removes_the_paper_and_its_files(client, sample_pdf):
    pid = _upload(client, sample_pdf).json()["id"]
    _wait_done(client, pid)
    res = client.delete(f"/api/papers/{pid}", headers=CLIENT)
    assert res.status_code == 204 and res.content == b""
    assert client.get(f"/api/papers/{pid}").status_code == 404
    assert client.get("/api/papers", headers=CLIENT).json() == []
    assert not any(p.exists() for p in _files(pid))


def test_delete_hides_existence_from_other_clients(client, sample_pdf):
    pid = _upload(client, sample_pdf).json()["id"]
    _wait_done(client, pid)
    assert client.delete(f"/api/papers/{pid}", headers=OTHER).status_code == 404
    assert client.delete(f"/api/papers/{pid}").status_code == 404  # X-Client-Id なし
    assert client.delete("/api/papers/0000000000000000", headers=CLIENT).status_code == 404
    assert client.delete("/api/papers/..%2F..%2Fetc", headers=CLIENT).status_code == 404
    assert client.get(f"/api/papers/{pid}").status_code == 200


def test_delete_refuses_old_records_without_owner(client, sample_pdf):
    pid = _upload(client, sample_pdf).json()["id"]
    _wait_done(client, pid)
    store.update(pid, owner=None)
    assert client.delete(f"/api/papers/{pid}", headers=CLIENT).status_code == 404
    assert client.get(f"/api/papers/{pid}").status_code == 200


def test_delete_keeps_a_copy_made_from_the_same_pdf(client, sample_pdf):
    first = _upload(client, sample_pdf).json()["id"]
    _wait_done(client, first)
    second = _upload(client, sample_pdf, OTHER).json()
    assert second["reused"] is True
    assert client.delete(f"/api/papers/{first}", headers=CLIENT).status_code == 204
    other = client.get(f"/api/papers/{second['id']}").json()
    assert other["status"] == "done" and other["results"]["step1"]
    assert client.get(f"/api/papers/{second['id']}/pdf").status_code == 200


def test_deleted_paper_is_not_reused_for_new_uploads(client, sample_pdf):
    pid = _upload(client, sample_pdf).json()["id"]
    _wait_done(client, pid)
    client.delete(f"/api/papers/{pid}", headers=CLIENT)
    again = _upload(client, sample_pdf).json()
    assert again["reused"] is False and again["id"] != pid


def test_delete_while_analysing_leaves_nothing_behind(client, service, sample_pdf, monkeypatch):
    gate = _hold_step1(monkeypatch)
    pid = _upload(client, sample_pdf).json()["id"]
    assert client.delete(f"/api/papers/{pid}", headers=CLIENT).status_code == 204
    gate.set()
    _wait_idle(service)
    assert not any(p.exists() for p in _files(pid))  # 解析のスレッドが書き戻していない
    assert service.take_over(pid) is None


def test_delete_cancels_a_running_analysis_first(client, service, sample_pdf, monkeypatch):
    calls = []
    real = service.cancel
    monkeypatch.setattr(service, "cancel", lambda pid: (calls.append(pid), real(pid))[1])
    gate = _hold_step1(monkeypatch)
    pid = _upload(client, sample_pdf).json()["id"]
    client.delete(f"/api/papers/{pid}", headers=CLIENT)
    gate.set()
    _wait_idle(service)
    assert calls == [pid]


def test_delete_is_rate_limited(client, service, sample_pdf):
    pid = _upload(client, sample_pdf).json()["id"]
    _wait_done(client, pid)
    service.delete_limiter = RateLimiter(2, 60)
    assert client.delete(f"/api/papers/{pid}", headers=OTHER).status_code == 404
    assert client.delete(f"/api/papers/{pid}", headers=OTHER).status_code == 404
    assert client.delete(f"/api/papers/{pid}", headers=OTHER).status_code == 429
    assert client.get(f"/api/papers/{pid}").status_code == 200
