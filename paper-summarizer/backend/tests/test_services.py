"""解析と Q&A の組み立て（services）のテスト。解析器を差し替えて、Gemini を呼ばずに流れを確かめる。"""

import json
import threading
from types import SimpleNamespace

import pytest
from make_sample_pdf import make_pdf

from app import config, gemini, mock, pdf_utils, services, store
from app.schemas import Paper
from app.services import AskFailed, DemoAnalyzer, GeminiAnalyzer, PaperService


class FakeAnalyzer:
    """呼ばれた Step を記録し、本物の PDF の文を引用として返す。"""

    QUOTE = "This sentence belongs to page 2 of the sample."

    def __init__(self, delay: threading.Event | None = None):
        self.calls: list[str] = []
        self.delay = delay

    def _ev(self):
        return {"page": 2, "quote": self.QUOTE}

    def step1(self, src):
        if self.delay:
            self.delay.wait(5)
        self.calls.append("step1")
        return {"title": src.paper.filename, "evidence": [self._ev()]}

    def step2(self, src, s1):
        self.calls.append("step2")
        return {"from_step1": s1["title"], "evidence": [self._ev()]}

    def step3(self, src, s1):
        self.calls.append("step3")
        return {"evidence": [self._ev()]}

    def ask(self, src, question, history, current_step):
        self.calls.append("ask")
        return {"answer": f"A:{question}:{len(history)}", "source": "paper", "evidence": [self._ev()], "confidence": "high"}


def _new_paper(demo: bool, **kw) -> str:
    pid = store.new_id()
    data = make_pdf(3)
    store.save_pdf(pid, data)
    store.save(
        {
            "id": pid,
            "filename": "a.pdf",
            "sha256": "h",
            "level": "undergrad",
            "page_count": 3,
            "status": "queued",
            "error": None,
            "demo": demo,
            "results": {},
            "messages": [],
            "created_at": store.now(),
            **kw,
        }
    )
    return pid


def _service(fake, demo=False):
    return PaperService(analyzers={demo: fake, not demo: FakeAnalyzer()}, starter=lambda _pid: None)


def test_run_analysis_runs_all_steps_and_verifies():
    fake = FakeAnalyzer()
    pid = _new_paper(demo=False)
    _service(fake).run_analysis(pid)
    paper = store.load(pid)
    assert paper["status"] == "done"
    assert fake.calls == ["step1", "step2", "step3"]
    assert paper["results"]["step2"]["from_step1"] == "a.pdf"
    assert paper["results"]["step1"]["evidence"][0]["verified"] is True


def test_run_analysis_is_idempotent():
    fake = FakeAnalyzer()
    svc = _service(fake)
    pid = _new_paper(demo=False)
    svc.run_analysis(pid)
    first = store.load(pid)
    svc.run_analysis(pid)  # Cloud Tasks の再試行で2回目が来ても再生成しない
    assert fake.calls == ["step1", "step2", "step3"]
    assert store.load(pid)["results"] == first["results"]
    assert store.load(pid)["status"] == "done"


def test_run_analysis_resumes_from_missing_steps():
    fake = FakeAnalyzer()
    pid = _new_paper(demo=False, status="failed", results={"step1": {"title": "kept"}})
    _service(fake).run_analysis(pid)
    assert fake.calls == ["step2", "step3"]
    assert store.load(pid)["results"]["step1"] == {"title": "kept"}


def test_concurrent_run_analysis_for_same_paper_runs_once():
    gate = threading.Event()
    fake = FakeAnalyzer(delay=gate)
    svc = _service(fake)
    pid = _new_paper(demo=False)
    threads = [threading.Thread(target=svc.run_analysis, args=(pid,)) for _ in range(3)]
    for t in threads:
        t.start()
    gate.set()
    for t in threads:
        t.join(timeout=10)
    assert fake.calls.count("step1") == 1


def test_analyzer_is_chosen_by_paper_demo_flag(monkeypatch):
    demo, real = FakeAnalyzer(), FakeAnalyzer()
    svc = PaperService(analyzers={True: demo, False: real}, starter=lambda _pid: None)
    monkeypatch.setattr(config, "DEMO_MODE", True)
    pid = _new_paper(demo=False)
    svc.run_analysis(pid)
    svc.ask(pid, "q", None)
    assert real.calls == ["step1", "step2", "step3", "ask"]
    assert demo.calls == []


def test_ask_appends_messages_and_passes_history():
    fake = FakeAnalyzer()
    svc = _service(fake)
    pid = _new_paper(demo=False, status="done")
    svc.ask(pid, "q1", 1)
    msgs = svc.ask(pid, "q2", 2)
    assert [m["role"] for m in msgs] == ["user", "assistant"] * 2
    assert msgs[3]["text"] == "A:q2:2"
    assert msgs[3]["evidence"][0]["verified"] is True


def test_ask_wraps_errors_with_fixed_message():
    class Broken(FakeAnalyzer):
        def ask(self, *_a):
            raise RuntimeError("secret detail")

    pid = _new_paper(demo=False, status="done")
    with pytest.raises(AskFailed) as e:
        _service(Broken()).ask(pid, "q", None)
    assert "secret" not in e.value.message


def test_ask_uses_cached_pages_without_reextracting(monkeypatch):
    fake = FakeAnalyzer()
    svc = _service(fake)
    pid = _new_paper(demo=False, status="done")
    svc.ask(pid, "q1", None)  # キャッシュがなければ1回だけ抽出して保存する
    assert store.load_pages(pid) is not None
    monkeypatch.setattr(services, "extract_pages", lambda *_a, **_k: pytest.fail("ページを再抽出しない"))
    svc.ask(pid, "q2", None)


def test_create_caches_normalized_pages_and_starts_job():
    started = []
    svc = PaperService(analyzers={True: FakeAnalyzer(), False: FakeAnalyzer()}, starter=started.append)
    data = make_pdf(3)
    pages = pdf_utils.extract_pages(data)
    pid, reused = svc.create(data=data, pages=pages, filename="x.pdf", level="grad")
    assert reused is False
    assert started == [pid]
    raw, norm = store.load_pages(pid)
    assert raw == pages
    assert norm == [pdf_utils.normalize(p) for p in pages]


def test_retry_only_from_retryable_states():
    started = []
    svc = PaperService(analyzers={True: FakeAnalyzer(), False: FakeAnalyzer()}, starter=started.append)
    done = _new_paper(demo=False, status="done")
    failed = _new_paper(demo=False, status="failed")
    assert svc.retry(done) is False
    assert svc.retry(failed) is True
    assert svc.retry(failed) is False  # 二度目は queued なので受け付けない
    assert started == [failed]


def test_demo_analyzer_delegates_to_mock():
    data = make_pdf(3)
    pages = pdf_utils.extract_pages(data)
    paper = services.Paper.model_validate(store.load(_new_paper(demo=True)))
    src = services.PaperSource(paper=paper, pdf_bytes=data, pages=pages, norm_pages=[])
    a = DemoAnalyzer()
    s1 = a.step1(src)
    assert s1["summary"]
    assert a.step2(src, s1)["stages"]
    assert a.step3(src, s1)["pros"]
    assert a.ask(src, "q", [], None)["answer"]


def test_gemini_analyzer_creates_client_once_and_passes_it(monkeypatch):
    created = []

    class Models:
        def generate_content(self, model, contents, config):
            return SimpleNamespace(parsed=None, text=json.dumps(payload[0]))

    payload = [mock.step1(["Some page text about attention and reading. " * 4], "a.pdf")]
    monkeypatch.setattr(gemini, "client", lambda: created.append(1) or SimpleNamespace(models=Models()))
    data = make_pdf(3)
    paper = services.Paper.model_validate(store.load(_new_paper(demo=False)))
    src = services.PaperSource(paper=paper, pdf_bytes=data, pages=[], norm_pages=[])
    a = GeminiAnalyzer()
    a.step1(src)
    payload[0] = mock.step2(["x " * 50])
    a.step2(src, {"title": "t"})
    payload[0] = mock.step3(["x " * 50])
    a.step3(src, {"title": "t"})
    payload[0] = mock.ask(["x " * 50], "q")
    a.ask(src, "q", [], None)
    assert created == [1]


def test_is_stale_handles_missing_or_bad_timestamp():
    assert services.is_stale({"updated_at": None, "created_at": None}) is True
    assert services.is_stale({"updated_at": "not a date"}) is True
    assert services.is_stale({"updated_at": store.now()}) is False


def test_gemini_analyzer_passes_paper_lang(monkeypatch):
    seen = []
    fake_mod = SimpleNamespace(
        step1=lambda pdf, level, **kw: seen.append(("step1", level, kw["lang"])) or {},
        step2=lambda pdf, level, s1, **kw: seen.append(("step2", level, kw["lang"])) or {},
        step3=lambda pdf, level, s1, **kw: seen.append(("step3", level, kw["lang"])) or {},
        ask=lambda pdf, level, q, h, c, **kw: seen.append(("ask", level, kw["lang"])) or {},
    )
    analyzer = GeminiAnalyzer()
    monkeypatch.setattr(analyzer, "_gemini", lambda: fake_mod)
    monkeypatch.setattr(analyzer, "_cli", lambda: None)
    src = SimpleNamespace(pdf_bytes=b"", paper=SimpleNamespace(level="grad", lang="en"))
    analyzer.step1(src)
    analyzer.step2(src, {})
    analyzer.step3(src, {})
    analyzer.ask(src, "q", [], None)
    assert seen == [(n, "grad", "en") for n in ("step1", "step2", "step3", "ask")]


def test_create_stores_lang_and_old_records_load_as_ja():
    svc = PaperService(analyzers={True: FakeAnalyzer(), False: FakeAnalyzer()}, starter=lambda _pid: None)
    data = make_pdf(3)
    pid, _ = svc.create(data=data, pages=pdf_utils.extract_pages(data), filename="x.pdf", level="grad", lang="en")
    assert store.load(pid)["lang"] == "en"
    assert Paper.model_validate({"id": "x", "filename": "f"}).lang == "ja"


def test_analysis_records_the_analysis_version_and_reuse_copies_it():
    svc = _service(FakeAnalyzer())
    pid = _new_paper(demo=False)
    svc.run_analysis(pid)
    assert store.load(pid)["analysis_version"] == config.ANALYSIS_VERSION
    data = make_pdf(3)
    copy, reused = svc.create(data=data, pages=pdf_utils.extract_pages(data), filename="x.pdf", level="undergrad", sha256="h")
    assert reused is True
    assert store.load(copy)["analysis_version"] == config.ANALYSIS_VERSION


def test_results_from_an_older_analysis_version_are_analyzed_again():
    started = []
    svc = PaperService(analyzers={True: FakeAnalyzer(), False: FakeAnalyzer()}, starter=started.append)
    _new_paper(demo=False, status="done", results={"step1": {}}, analysis_version=config.ANALYSIS_VERSION - 1)
    data = make_pdf(3)
    pid, reused = svc.create(data=data, pages=pdf_utils.extract_pages(data), filename="x.pdf", level="undergrad", sha256="h")
    assert reused is False
    assert started == [pid]
