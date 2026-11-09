"""解析の進捗（プロセス内の記録、記録への要約、デモ解析器の進み方）のテスト。"""

import threading

from test_services import FakeAnalyzer, _new_paper
from test_takeover import _svc, _wait

from app import store
from app.heartbeat import Heartbeat
from app.progress import ProgressTracker
from app.services import DemoAnalyzer, PaperSource, running


class Clock:
    def __init__(self):
        self.t = 100.0

    def __call__(self):
        return self.t


# ---------- ProgressTracker ----------


def test_tracker_follows_a_step_through_its_phases():
    clock = Clock()
    p = ProgressTracker(clock=clock)
    assert p.snapshot("a") is None and p.summary("a") is None
    p.begin("a", "step1")
    assert p.snapshot("a") == {"step1": {"phase": "reading", "chars": 0, "elapsed": 0.0}}
    clock.t += 3
    p.wrote("a", "step1", 1200)
    assert p.snapshot("a") == {"step1": {"phase": "writing", "chars": 1200, "elapsed": 3.0}}
    clock.t += 5
    p.verifying("a", "step1")
    assert p.snapshot("a")["step1"] == {"phase": "verifying", "chars": 1200, "elapsed": 8.0}
    clock.t += 2
    p.finish("a", "step1")
    clock.t += 50
    assert p.snapshot("a")["step1"] == {"phase": "done", "chars": 1200, "elapsed": 10.0}  # 終わった Step の時間は止まる


def test_summary_has_only_phase_and_chars():
    p = ProgressTracker(clock=Clock())
    p.begin("a", "step2")
    p.wrote("a", "step2", 50)
    assert p.summary("a") == {"step2": {"phase": "writing", "chars": 50}}


def test_tracker_keeps_papers_and_steps_apart():
    p = ProgressTracker(clock=Clock())
    p.begin("a", "step2")
    p.begin("a", "step3")
    p.begin("b", "step1")
    p.wrote("a", "step3", 7)
    assert set(p.snapshot("a")) == {"step2", "step3"} and p.snapshot("a")["step2"]["chars"] == 0
    assert set(p.snapshot("b")) == {"step1"}


def test_late_character_counts_do_not_move_a_step_back():
    p = ProgressTracker(clock=Clock())
    p.begin("a", "step1")
    p.verifying("a", "step1")
    p.wrote("a", "step1", 9)  # 照合に入ったあとに届いた古い通知
    assert p.snapshot("a")["step1"]["phase"] == "verifying"
    p.wrote("zzz", "step1", 1)  # 始まっていない Step への通知は無視する
    assert p.snapshot("zzz") is None


def test_snapshots_are_copies():
    p = ProgressTracker(clock=Clock())
    p.begin("a", "step1")
    snap = p.snapshot("a")
    snap["step1"]["chars"] = 999
    assert p.snapshot("a")["step1"]["chars"] == 0


def test_clear_forgets_the_paper():
    p = ProgressTracker(clock=Clock())
    p.begin("a", "step1")
    p.clear("a")
    p.clear("a")
    assert p.snapshot("a") is None


def test_tracker_is_safe_to_update_from_many_threads():
    p = ProgressTracker()
    p.begin("a", "step1")
    threads = [threading.Thread(target=lambda n=n: [p.wrote("a", "step1", n * 100 + i) for i in range(200)]) for n in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert p.snapshot("a")["step1"]["phase"] == "writing"


# ---------- 解析との結び付き ----------


class StreamingAnalyzer(FakeAnalyzer):
    """Gemini のストリーミングのように、src.on_progress に文字数を伝える。中間の様子は seen に残す。"""

    def __init__(self, svc_ref):
        super().__init__()
        self.svc_ref = svc_ref
        self.seen: dict[str, dict] = {}
        self.at_step1_done: dict | None = None

    def _stream(self, src, key, counts):
        pid = src.paper.id
        self.seen[f"{key}-start"] = self.svc_ref().progress.snapshot(pid)
        for n in counts:
            src.on_progress(n)
        self.seen[f"{key}-end"] = self.svc_ref().progress.snapshot(pid)

    def step1(self, src):
        self._stream(src, "step1", [10, 300])
        return super().step1(src)

    def step2(self, src, s1):
        self._stream(src, "step2", [20])
        return super().step2(src, s1)

    def step3(self, src, s1):
        self._stream(src, "step3", [30, 40])
        return super().step3(src, s1)


def test_analysis_reports_each_step_and_clears_afterwards():
    holder = []
    fake = StreamingAnalyzer(lambda: holder[0])
    svc = _svc(fake)
    holder.append(svc)
    pid = _new_paper(demo=False)
    svc.run_analysis(pid)
    assert fake.seen["step1-start"]["step1"]["phase"] == "reading"
    assert fake.seen["step1-end"]["step1"] == {"phase": "writing", "chars": 300, "elapsed": fake.seen["step1-end"]["step1"]["elapsed"]}
    assert fake.seen["step2-end"]["step1"]["phase"] == "done"  # 前の Step は終わった印がつく
    assert fake.seen["step2-end"]["step2"]["chars"] == 20 and fake.seen["step3-end"]["step3"]["chars"] == 40
    assert store.load(pid)["status"] == "done"
    assert svc.progress.snapshot(pid) is None  # 終わったら捨てる


def test_progress_is_cleared_when_the_analysis_fails():
    class Boom(FakeAnalyzer):
        def step1(self, src):
            src.on_progress(5)
            raise RuntimeError("x")

    svc = _svc(Boom())
    pid = _new_paper(demo=False)
    svc.run_analysis(pid)
    assert store.load(pid)["status"] == "failed" and svc.progress.snapshot(pid) is None


def test_analyzers_without_progress_support_still_work():
    svc = _svc(FakeAnalyzer())
    pid = _new_paper(demo=False)
    svc.run_analysis(pid)
    assert store.load(pid)["status"] == "done"


def test_progress_of_prefers_the_process_then_the_record_and_hides_finished_ones():
    svc = _svc()
    pid = _new_paper(demo=False, status="processing_step1", progress={"step1": {"phase": "writing", "chars": 5}})
    paper = store.load(pid)
    assert svc.progress_of(paper) == {"step1": {"phase": "writing", "chars": 5}}  # 別のサーバーの解析は記録の要約を使う
    svc.progress.begin(pid, "step1")
    assert svc.progress_of(paper)["step1"]["elapsed"] >= 0  # このプロセスで走っていれば、経過時間つき
    assert svc.progress_of({**paper, "status": "done"}) is None
    assert svc.progress_of({**paper, "status": "failed"}) is None
    assert svc.progress_of({**paper, "progress": None}) is not None  # プロセス内の方が先
    svc.progress.clear(pid)
    assert svc.progress_of({**paper, "progress": None}) is None


# ---------- heartbeat が要約を記録に入れる ----------


def test_heartbeat_writes_the_progress_summary_to_the_record():
    svc = _svc()
    pid = _new_paper(demo=False, status="processing_step1")
    svc.progress.begin(pid, "step1")
    svc.progress.wrote(pid, "step1", 321)
    Heartbeat(pid, 10, running, extra=lambda: {"progress": svc.progress.summary(pid)}).beat()
    saved = store.load(pid)
    assert saved["progress"] == {"step1": {"phase": "writing", "chars": 321}}
    assert saved["heartbeat_at"]


def test_heartbeat_without_extra_keeps_working():
    pid = _new_paper(demo=False, status="processing_step1")
    assert Heartbeat(pid, 10, running).beat() is True
    assert "progress" not in store.load(pid)


def test_the_running_analysis_puts_its_progress_in_the_record_via_heartbeat():
    class Hold(FakeAnalyzer):
        def __init__(self):
            super().__init__()
            self.entered = threading.Event()
            self.gate = threading.Event()

        def step1(self, src):
            src.on_progress(777)
            self.entered.set()
            assert self.gate.wait(5)
            return super().step1(src)

    fake = Hold()
    svc = _svc(fake, heartbeat_sec=0.01)
    pid = _new_paper(demo=False)
    t = threading.Thread(target=svc.run_analysis, args=(pid,))
    t.start()
    assert fake.entered.wait(5)
    assert _wait(lambda: (store.load(pid).get("progress") or {}).get("step1", {}).get("chars") == 777)
    fake.gate.set()
    t.join(5)


def test_retry_drops_the_old_progress_summary():
    svc = _svc()
    pid = _new_paper(demo=False, status="failed", progress={"step1": {"phase": "writing", "chars": 5}})
    assert svc.retry(pid)
    assert store.load(pid)["progress"] is None


# ---------- デモ解析器 ----------


def _demo_src():
    pid = _new_paper(demo=True)
    svc = _svc()
    paper = store.load(pid)
    from app.schemas import Paper

    return svc.source(Paper.model_validate(paper))


def test_demo_analyzer_advances_progress_in_steps(monkeypatch):
    from app import mock

    slept = []
    monkeypatch.setattr(mock, "time", type("T", (), {"sleep": staticmethod(slept.append)}))
    seen = []
    src = PaperSource(**{**_demo_src().__dict__, "on_progress": seen.append})
    DemoAnalyzer().step1(src)
    assert len(seen) >= 4 and seen == sorted(seen) and seen[-1] > seen[0] > 0
    assert 1.5 <= sum(slept) <= 4.0  # 数秒かけて進む（e2e が遅くなりすぎない範囲）


def test_demo_analyzer_works_without_a_callback():
    DemoAnalyzer().step3(_demo_src(), {})
