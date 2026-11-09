"""止まった解析の引き継ぎ（heartbeat）と、Step 2・3 の並列実行のテスト。時刻は now を渡して決める。"""

import logging
import threading
import time
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from test_services import FakeAnalyzer, GatedAnalyzer, _new_paper

from app import config, errors, main, services, store
from app.services import PaperService

NOW = datetime(2026, 11, 9, 2, 11, 30, tzinfo=UTC)
CLIENT_ID = "test-client-0000000001"


def _ago(sec: float) -> str:
    return (NOW - timedelta(seconds=sec)).isoformat()


def _svc(fake=None, started=None, **kw) -> PaperService:
    fake = fake or FakeAnalyzer()
    starter = started.append if started is not None else (lambda _pid: None)
    return PaperService(analyzers={True: fake, False: fake}, starter=starter, **kw)


def _stale(**kw) -> str:
    return _new_paper(demo=False, status="processing_step1", heartbeat_at=_ago(60), **kw)


def _wait(cond, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.005)
    return False


# ---------- heartbeat ----------


def test_heartbeat_is_written_during_a_gemini_call_without_breaking_other_fields():
    fake = GatedAnalyzer(hold="step1")
    svc = _svc(fake, heartbeat_sec=0.01)
    pid = _new_paper(demo=False)
    t = threading.Thread(target=svc.run_analysis, args=(pid,))
    t.start()
    assert fake.entered.wait(5)
    assert _wait(lambda: store.load(pid).get("heartbeat_at"))
    first = store.load(pid)["heartbeat_at"]
    assert _wait(lambda: store.load(pid)["heartbeat_at"] != first)  # Gemini の呼び出し中も更新され続ける
    mid = store.load(pid)
    assert mid["status"] == "processing_step1" and mid["filename"] == "a.pdf" and mid["messages"] == []
    fake.gate.set()
    t.join(5)
    done = store.load(pid)
    assert done["status"] == "done"
    time.sleep(0.05)
    assert store.load(pid)["heartbeat_at"] == done["heartbeat_at"]  # 終わったら止まる
    assert store.load(pid)["status"] == "done"  # 終わったあとの書き込みで状態を戻さない


def test_heartbeat_does_not_touch_a_cancelled_paper():
    fake = GatedAnalyzer(hold="step1")
    svc = _svc(fake, heartbeat_sec=0.01)
    pid = _new_paper(demo=False)
    t = threading.Thread(target=svc.run_analysis, args=(pid,))
    t.start()
    assert fake.entered.wait(5)
    svc.cancel(pid)
    stamp = store.load(pid).get("heartbeat_at")
    time.sleep(0.05)
    assert store.load(pid).get("heartbeat_at") == stamp
    fake.gate.set()
    t.join(5)
    assert store.load(pid)["status"] == "cancelled"


def test_heartbeat_thread_stops_when_analysis_fails():
    class Boom(FakeAnalyzer):
        def step1(self, src):
            raise RuntimeError("boom")

    svc = _svc(Boom(), heartbeat_sec=0.01)
    pid = _new_paper(demo=False)
    svc.run_analysis(pid)
    assert store.load(pid)["status"] == "failed"
    assert not [t for t in threading.enumerate() if t.name == f"heartbeat-{pid}"]


# ---------- 引き継ぎ ----------


def test_takes_over_only_after_the_threshold(caplog):
    started: list[str] = []
    svc = _svc(started=started)
    fresh = _new_paper(demo=False, status="processing_step1", heartbeat_at=_ago(config.TAKEOVER_AFTER_SEC - 1))
    assert svc.take_over(fresh, now=NOW) is None
    assert started == []
    stale_sec = config.TAKEOVER_AFTER_SEC + 1
    pid = _new_paper(demo=False, status="processing_step2", heartbeat_at=_ago(stale_sec), results={"step1": {"title": "t"}})
    with caplog.at_level(logging.INFO, logger="paper"):
        paper = svc.take_over(pid, now=NOW)
    assert paper is not None and paper["takeovers"] == 1
    assert paper["heartbeat_at"] == NOW.isoformat()
    assert started == [pid]
    assert f"paper={pid} taken over (stale heartbeat {stale_sec}s, attempt 1)" in caplog.text
    assert svc.take_over(pid, now=NOW) is None  # 引き継いだ直後は heartbeat が新しいので、二重に引き継がない
    assert started == [pid]


def test_without_heartbeat_falls_back_to_updated_at_then_created_at():
    started: list[str] = []
    svc = _svc(started=started)
    pid = _new_paper(demo=False, status="queued")
    later = datetime.now(UTC) + timedelta(seconds=config.TAKEOVER_AFTER_SEC + 5)
    assert svc.take_over(pid, now=later) is not None
    assert started == [pid]
    assert services.last_alive({"created_at": _ago(100)}) == NOW - timedelta(seconds=100)
    assert services.last_alive({"updated_at": _ago(5), "created_at": _ago(100)}) == NOW - timedelta(seconds=5)
    assert services.last_alive({"heartbeat_at": _ago(1), "updated_at": _ago(5)}) == NOW - timedelta(seconds=1)
    assert services.last_alive({"heartbeat_at": "bad", "updated_at": _ago(5)}) is None


def test_does_not_take_over_other_states_or_missing_papers():
    started: list[str] = []
    svc = _svc(started=started)
    for status in ("done", "failed", "cancelled"):
        pid = _new_paper(demo=False, status=status, heartbeat_at=_ago(3600))
        assert svc.take_over(pid, now=NOW) is None
    assert svc.take_over("0" * 16, now=NOW) is None
    assert started == []


def test_does_not_take_over_what_this_process_is_running():
    started: list[str] = []
    svc = _svc(started=started)
    pid = _stale()
    svc._running.add(pid)
    assert svc.take_over(pid, now=NOW) is None
    assert started == []


def test_gives_up_with_failed_after_the_takeover_limit():
    started: list[str] = []
    svc = _svc(started=started)
    pid = _stale(takeovers=config.MAX_TAKEOVERS, results={"step1": {"title": "kept"}})
    assert svc.take_over(pid, now=NOW) is None
    paper = store.load(pid)
    assert paper["status"] == "failed"
    assert paper["error"] == errors.TAKEN_OVER_TOO_MANY
    assert paper["results"] == {"step1": {"title": "kept"}}
    assert started == []
    assert services.retryable(paper)  # 画面の「再実行」に任せる


def test_takeovers_count_up_to_the_limit_then_fail():
    started: list[str] = []
    svc = _svc(started=started)
    pid = _stale()
    now = NOW
    for attempt in range(1, config.MAX_TAKEOVERS + 1):
        assert svc.take_over(pid, now=now)["takeovers"] == attempt
        now += timedelta(seconds=config.TAKEOVER_AFTER_SEC + 1)
    assert svc.take_over(pid, now=now) is None
    assert store.load(pid)["status"] == "failed"
    assert len(started) == config.MAX_TAKEOVERS


def test_takeover_does_not_use_the_daily_analysis_quota():
    class NoQuota:
        def take(self):
            raise AssertionError("引き継ぎで上限を使ってはいけない")

    svc = _svc()
    svc.analysis_quota = NoQuota()  # type: ignore[assignment]
    assert svc.take_over(_stale(), now=NOW) is not None


def test_takeover_resumes_from_unfinished_steps_only():
    fake = FakeAnalyzer()
    svc = PaperService(analyzers={True: fake, False: fake}, starter=lambda pid: svc.run_analysis(pid))
    pid = _stale(results={"step1": {"title": "kept", "evidence": []}})
    assert svc.take_over(pid, now=NOW) is not None
    paper = store.load(pid)
    assert paper["status"] == "done"
    assert sorted(fake.calls) == ["step2", "step3"]  # 終わった Step 1 は飛ばす
    assert paper["results"]["step1"] == {"title": "kept", "evidence": []}


def test_cancel_wins_over_takeover():
    started: list[str] = []
    svc = _svc(started=started)
    pid = _stale()
    assert svc.cancel(pid) is True
    assert svc.take_over(pid, now=NOW) is None
    assert store.load(pid)["status"] == "cancelled"
    assert started == []


def test_retry_resets_takeover_counters():
    svc = _svc()
    pid = _new_paper(demo=False, status="failed", takeovers=3, heartbeat_at=_ago(3600))
    assert svc.retry(pid) is True
    paper = store.load(pid)
    assert paper["takeovers"] == 0 and paper["heartbeat_at"] is None
    assert svc.take_over(pid, now=datetime.now(UTC)) is None  # 再実行した直後に古い heartbeat で引き継がれない


def test_is_stale_uses_injected_now():
    assert services.is_stale({"updated_at": _ago(config.STALE_AFTER_SEC + 1)}, now=NOW) is True
    assert services.is_stale({"updated_at": _ago(config.STALE_AFTER_SEC - 1)}, now=NOW) is False


def test_demo_mode_runs_through_the_same_path():
    svc = PaperService(starter=lambda pid: svc.run_analysis(pid))
    pid = _new_paper(demo=True, status="processing_step1", heartbeat_at=_ago(60))
    assert svc.take_over(pid, now=NOW) is not None
    paper = store.load(pid)
    assert paper["status"] == "done" and set(paper["results"]) == {"step1", "step2", "step3"}


# ---------- API ----------


def _api(svc):
    main.app.dependency_overrides[main.get_service] = lambda: svc
    return TestClient(main.app)


def test_get_paper_and_list_take_over_stale_analysis():
    started: list[str] = []
    svc = _svc(started=started)
    owner = store.owner_of(CLIENT_ID)
    pid = _new_paper(demo=False, status="processing_step1", heartbeat_at=_ago(3600), owner=owner)
    pid2 = _new_paper(demo=False, status="queued", heartbeat_at=_ago(3600), owner=owner)
    try:
        client = _api(svc)
        body = client.get(f"/api/papers/{pid}").json()
        assert started == [pid] and body["takeovers"] == 1
        items = client.get("/api/papers", headers={"X-Client-Id": CLIENT_ID}).json()
        assert {i["id"] for i in items} == {pid, pid2}
        assert sorted(started) == sorted([pid, pid2])  # 一覧でも引き継ぐ。引き継ぎ済みの pid は増えない
    finally:
        main.app.dependency_overrides.clear()


def test_get_paper_does_not_take_over_cancelled():
    started: list[str] = []
    svc = _svc(started=started)
    pid = _new_paper(demo=False, status="cancelled", heartbeat_at=_ago(3600))
    try:
        assert _api(svc).get(f"/api/papers/{pid}").json()["status"] == "cancelled"
    finally:
        main.app.dependency_overrides.clear()
    assert started == []


# ---------- Step 2 と Step 3 の並列 ----------


class Concurrent(FakeAnalyzer):
    """Step 2 と Step 3 が同時に呼ばれたときだけ先に進める（順に呼ぶと待ちきれず失敗する）。"""

    def __init__(self):
        super().__init__()
        self.barrier = threading.Barrier(2, timeout=5)

    def step2(self, src, s1):
        self.barrier.wait()
        return super().step2(src, s1)

    def step3(self, src, s1):
        self.barrier.wait()
        return super().step3(src, s1)


def test_step2_and_step3_run_concurrently():
    pid = _new_paper(demo=False)
    _svc(Concurrent()).run_analysis(pid)
    paper = store.load(pid)
    assert paper["status"] == "done", paper["error"]
    assert set(paper["results"]) == {"step1", "step2", "step3"}
    assert paper["results"]["step2"]["from_step1"] == "a.pdf"


def test_status_follows_the_remaining_step_when_one_finishes_first():
    class Hold3(GatedAnalyzer):
        def step3(self, src, s1):
            self._maybe_hold("step3")
            return super().step3(src, s1)

    fake = Hold3(hold="step3")
    svc = _svc(fake)
    pid = _new_paper(demo=False)
    t = threading.Thread(target=svc.run_analysis, args=(pid,))
    t.start()
    assert fake.entered.wait(5)
    assert _wait(lambda: "step2" in store.load(pid)["results"])
    assert _wait(lambda: store.load(pid)["status"] == "processing_step3")  # Step 2 が先に終わったら、残りの Step 3 を示す
    fake.gate.set()
    t.join(5)
    assert store.load(pid)["status"] == "done"


def test_one_step_failing_keeps_the_other_and_retry_makes_only_the_missing_one():
    class Step3Fails(FakeAnalyzer):
        fail = True

        def step3(self, src, s1):
            if self.fail:
                raise RuntimeError("boom")
            return super().step3(src, s1)

    fake = Step3Fails()
    svc = _svc(fake)
    pid = _new_paper(demo=False, analysis_version=config.ANALYSIS_VERSION)
    svc.run_analysis(pid)
    paper = store.load(pid)
    assert paper["status"] == "failed" and paper["error"] == errors.GENERIC
    assert set(paper["results"]) == {"step1", "step2"}  # 成功した Step 2 は残る
    fake.fail = False
    fake.calls.clear()
    assert svc.retry(pid) is True
    svc.run_analysis(pid)
    assert fake.calls == ["step3"]
    assert store.load(pid)["status"] == "done"


def test_cancel_during_parallel_steps_discards_both_results():
    class Hold23(FakeAnalyzer):
        def __init__(self):
            super().__init__()
            self.entered = threading.Barrier(3, timeout=5)
            self.gate = threading.Event()

        def step2(self, src, s1):
            self.entered.wait()
            assert self.gate.wait(5)
            return super().step2(src, s1)

        def step3(self, src, s1):
            self.entered.wait()
            assert self.gate.wait(5)
            return super().step3(src, s1)

    fake = Hold23()
    svc = _svc(fake)
    pid = _new_paper(demo=False)
    t = threading.Thread(target=svc.run_analysis, args=(pid,))
    t.start()
    fake.entered.wait()  # 2つとも呼び出し中
    assert svc.cancel(pid) is True
    fake.gate.set()
    t.join(5)
    paper = store.load(pid)
    assert paper["status"] == "cancelled"
    assert set(paper["results"]) == {"step1"}
