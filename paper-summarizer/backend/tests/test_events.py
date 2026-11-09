"""解析の進捗を送る SSE（GET /api/papers/{id}/events）と、GET /api/papers/{id} の progress のテスト。"""

import json
import threading
import time
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from test_services import FakeAnalyzer, _new_paper

from app import config, events, main, store
from app.services import PaperService


@pytest.fixture(autouse=True)
def _fast(monkeypatch):
    monkeypatch.setattr(config, "SSE_TICK_SEC", 0.01)
    monkeypatch.setattr(config, "SSE_RECORD_SEC", 0.03)
    monkeypatch.setattr(config, "SSE_PING_SEC", 0.05)
    monkeypatch.setattr(config, "SSE_MAX_SEC", 5.0)
    monkeypatch.setattr(events, "slots", events.Slots(5))


@pytest.fixture
def started():
    return []


@pytest.fixture
def service(started):
    fake = FakeAnalyzer()
    return PaperService(analyzers={True: fake, False: fake}, starter=started.append)


@pytest.fixture
def client(service):
    main.app.dependency_overrides[main.get_service] = lambda: service
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


def _read(client, pid, limit=50):
    """閉じるまで読み、(データ行の中身のリスト, コメント行の数, 応答) を返す。"""
    data, comments = [], 0
    with client.stream("GET", f"/api/papers/{pid}/events") as r:
        for line in r.iter_lines():
            if line.startswith("data: "):
                data.append(json.loads(line[6:]))
            elif line.startswith(":"):
                comments += 1
            if len(data) + comments >= limit:
                break
        return data, comments, r


def test_unknown_or_invalid_id_is_404(client):
    assert client.get("/api/papers/0123456789abcdef/events").status_code == 404
    assert client.get("/api/papers/..%2Fx/events").status_code == 404


def test_finished_paper_gets_one_last_event_and_the_stream_closes(client):
    pid = _new_paper(demo=False, status="done")
    data, _c, r = _read(client, pid)
    assert data == [{"status": "done", "progress": None}]
    assert r.headers["content-type"].startswith("text/event-stream")
    assert "no-cache" in r.headers["cache-control"]
    assert r.headers["x-accel-buffering"] == "no"


@pytest.mark.parametrize("status", ["failed", "cancelled"])
def test_failed_and_cancelled_also_close(client, status):
    pid = _new_paper(demo=False, status=status)
    data, _c, _r = _read(client, pid)
    assert [d["status"] for d in data] == [status]


def test_in_process_progress_is_sent_then_the_final_event_closes(client, service):
    pid = _new_paper(demo=False, status="processing_step1", heartbeat_at=store.now())
    service.progress.begin(pid, "step1")
    service.progress.wrote(pid, "step1", 1200)

    def finish():
        time.sleep(0.15)
        service.progress.wrote(pid, "step1", 1800)
        time.sleep(0.15)
        store.transition(pid, lambda _p: True, status="done")

    t = threading.Thread(target=finish)
    t.start()
    data, _c, _r = _read(client, pid)
    t.join()
    first = data[0]
    assert first["status"] == "processing_step1"
    assert first["progress"]["step1"]["phase"] == "writing" and first["progress"]["step1"]["chars"] == 1200
    assert "elapsed" in first["progress"]["step1"]
    assert any(d["progress"] and d["progress"]["step1"]["chars"] == 1800 for d in data)
    assert data[-1] == {"status": "done", "progress": None}


def test_nothing_is_sent_again_while_nothing_changes(client, service):
    pid = _new_paper(demo=False, status="processing_step1", heartbeat_at=store.now())
    service.progress.begin(pid, "step1")
    service.progress.wrote(pid, "step1", 10)
    done = threading.Timer(0.3, lambda: store.transition(pid, lambda _p: True, status="done"))
    done.start()
    data, comments, _r = _read(client, pid)
    done.join()
    assert len(data) == 2  # 最初の1回と最後の1回だけ（経過時間が進むだけでは送り直さない）
    assert comments >= 2  # その間は数秒ごとのコメント行（: ping）で繋ぐ


def test_progress_from_another_server_comes_from_the_record(client):
    summary = {"step1": {"phase": "writing", "chars": 4200}}
    pid = _new_paper(demo=False, status="processing_step1", heartbeat_at=store.now(), progress=summary)
    done = threading.Timer(0.2, lambda: store.transition(pid, lambda _p: True, status="done"))
    done.start()
    data, _c, _r = _read(client, pid)
    done.join()
    assert data[0]["progress"] == summary
    assert data[-1]["status"] == "done"


def test_changes_in_the_record_are_followed(client):
    pid = _new_paper(demo=False, status="processing_step1", heartbeat_at=store.now())

    def advance():
        time.sleep(0.15)
        store.transition(
            pid, lambda _p: True, status="processing_step2", heartbeat_at=store.now(), progress={"step2": {"phase": "reading", "chars": 0}}
        )
        time.sleep(0.15)
        store.transition(pid, lambda _p: True, status="failed", error="x")

    t = threading.Thread(target=advance)
    t.start()
    data, _c, _r = _read(client, pid)
    t.join()
    assert [d["status"] for d in data] == ["processing_step1", "processing_step2", "failed"]
    assert data[1]["progress"] == {"step2": {"phase": "reading", "chars": 0}}


def test_a_stalled_analysis_is_taken_over_like_get(client, started):
    old = (datetime.now(UTC) - timedelta(seconds=300)).isoformat()
    pid = _new_paper(demo=False, status="processing_step1", heartbeat_at=old)
    _read(client, pid, limit=1)
    assert started == [pid]


def test_the_connection_is_closed_after_the_time_limit(client, monkeypatch):
    monkeypatch.setattr(config, "SSE_MAX_SEC", 0.2)
    pid = _new_paper(demo=False, status="processing_step1", heartbeat_at=store.now())
    began = time.monotonic()
    data, _c, _r = _read(client, pid)
    assert 0.15 <= time.monotonic() - began < 3
    assert data and data[-1]["status"] == "processing_step1"


def test_too_many_connections_get_429_and_slots_are_released(client, monkeypatch):
    monkeypatch.setattr(events, "slots", events.Slots(1))
    pid = _new_paper(demo=False, status="done")
    assert events.slots.acquire()
    assert client.get(f"/api/papers/{pid}/events").status_code == 429
    events.slots.release()
    assert client.get(f"/api/papers/{pid}/events").status_code == 200
    assert events.slots.acquire()  # 終わった接続の枠は返っている
    events.slots.release()


def test_unknown_paper_does_not_use_a_slot(client, monkeypatch):
    monkeypatch.setattr(events, "slots", events.Slots(1))
    client.get("/api/papers/0123456789abcdef/events")
    assert events.slots.acquire()


def test_slots_release_is_idempotent_per_connection():
    s = events.Slots(1)
    assert s.acquire() and not s.acquire()
    release = s.releaser()
    release()
    release()
    assert s.acquire() and not s.acquire()


def test_slots_do_not_go_below_zero_on_extra_release():
    s = events.Slots(2)
    s.release()
    assert s.acquire() and s.acquire() and not s.acquire()


# ---------- GET /api/papers/{id} の progress ----------


def test_get_paper_includes_progress_from_the_process(client, service):
    pid = _new_paper(demo=False, status="processing_step2", heartbeat_at=store.now())
    service.progress.begin(pid, "step2")
    service.progress.wrote(pid, "step2", 900)
    body = client.get(f"/api/papers/{pid}").json()
    assert body["progress"]["step2"]["chars"] == 900 and "elapsed" in body["progress"]["step2"]


def test_get_paper_falls_back_to_the_record_and_hides_it_when_finished(client):
    summary = {"step1": {"phase": "writing", "chars": 5}}
    pid = _new_paper(demo=False, status="processing_step1", heartbeat_at=store.now(), progress=summary)
    assert client.get(f"/api/papers/{pid}").json()["progress"] == summary
    store.transition(pid, lambda _p: True, status="done")
    assert client.get(f"/api/papers/{pid}").json()["progress"] is None


def test_get_paper_progress_is_null_without_any(client):
    pid = _new_paper(demo=False, status="queued", heartbeat_at=store.now())
    assert client.get(f"/api/papers/{pid}").json()["progress"] is None
