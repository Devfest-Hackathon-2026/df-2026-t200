import threading

import pytest

from app import config, store

OWNER = "o" * 32


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


def test_new_id_is_valid():
    pid = store.new_id()
    assert store.valid_id(pid)


@pytest.mark.parametrize("bad", ["", "xyz", "0123456789abcdeg", "../../etc/passwd", "0123456789ABCDEF"])
def test_valid_id_rejects_invalid(bad):
    assert not store.valid_id(bad)


def test_save_load_update_roundtrip():
    pid = store.new_id()
    store.save(_paper(pid))
    assert store.load(pid)["status"] == "queued"
    updated = store.update(pid, status="done")
    assert updated["status"] == "done"
    assert store.load(pid)["status"] == "done"
    assert "updated_at" in store.load(pid)


def test_load_missing_returns_none():
    assert store.load(store.new_id()) is None


def test_update_missing_raises():
    with pytest.raises(KeyError):
        store.update(store.new_id(), status="done")


def test_list_papers_sorted_newest_first():
    a, b = store.new_id(), store.new_id()
    store.save(_paper(a, created_at="2026-11-05T00:00:00+00:00"))
    store.save(_paper(b, created_at="2026-11-06T00:00:00+00:00", results={"step1": {"title": "T"}}))
    items = store.list_papers(OWNER)
    assert [i["id"] for i in items] == [b, a]
    assert items[0]["title"] == "T"
    assert items[1]["title"] is None


def test_find_by_hash_only_matches_done_with_same_level():
    pid = store.new_id()
    store.save(_paper(pid, sha256="h", level="grad", status="done"))
    store.save(_paper(store.new_id(), sha256="h", level="undergrad", status="processing_step1"))
    assert store.find_by_hash("h", "grad") == pid
    assert store.find_by_hash("h", "undergrad") is None
    assert store.find_by_hash("other", "grad") is None


def _run_threads(n, target):
    barrier = threading.Barrier(n)

    def run(i):
        barrier.wait()
        target(i)

    threads = [threading.Thread(target=run, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)


def test_concurrent_append_messages_keeps_all():
    pid = store.new_id()
    store.save(_paper(pid, messages=[]))

    def append(i):
        for j in range(10):
            store.append_messages(pid, {"role": "user", "text": f"{i}-{j}"}, {"role": "assistant", "text": f"a{i}-{j}"})

    _run_threads(8, append)
    msgs = store.load(pid)["messages"]
    assert len(msgs) == 8 * 10 * 2
    # 質問と回答の組が崩れない
    assert all(msgs[k]["role"] == "user" and msgs[k + 1]["text"] == "a" + msgs[k]["text"] for k in range(0, len(msgs), 2))


def test_concurrent_results_and_messages_do_not_overwrite_each_other():
    pid = store.new_id()
    store.save(_paper(pid, messages=[]))

    def work(i):
        for j in range(15):
            if i % 2:
                store.set_result(pid, f"step{i}-{j}", {"n": j})
            else:
                store.append_messages(pid, {"role": "user", "text": f"{i}-{j}"})

    _run_threads(6, work)
    paper = store.load(pid)
    assert len(paper["results"]) == 3 * 15
    assert len(paper["messages"]) == 3 * 15


def test_concurrent_update_does_not_lose_fields():
    pid = store.new_id()
    store.save(_paper(pid))
    _run_threads(10, lambda i: [store.update(pid, **{f"f{i}_{j}": j}) for j in range(10)])
    paper = store.load(pid)
    assert all(f"f{i}_{j}" in paper for i in range(10) for j in range(10))


def test_transition_is_atomic_compare_and_set():
    pid = store.new_id()
    store.save(_paper(pid, status="failed"))
    won = []

    def attempt(_i):
        if store.transition(pid, lambda p: p["status"] == "failed", status="queued") is not None:
            won.append(1)

    _run_threads(10, attempt)
    assert won == [1]
    assert store.load(pid)["status"] == "queued"


def test_transition_returns_none_when_not_allowed():
    pid = store.new_id()
    store.save(_paper(pid, status="done"))
    before = store.load(pid)
    assert store.transition(pid, lambda p: p["status"] == "failed", status="queued") is None
    assert store.load(pid) == before


def test_transition_missing_raises():
    with pytest.raises(KeyError):
        store.transition(store.new_id(), lambda _p: True, status="queued")


def test_save_does_not_mutate_callers_dict():
    pid = store.new_id()
    paper = _paper(pid)
    saved = store.save(paper)
    assert "updated_at" not in paper
    assert saved["updated_at"]


def test_list_and_find_skip_corrupt_json():
    pid = store.new_id()
    store.save(_paper(pid, sha256="h", level="grad", status="done"))
    (config.PAPER_DIR / "0123456789abcdef.json").write_text("{broken", encoding="utf-8")
    (config.PAPER_DIR / "fedcba9876543210.json").write_text('{"id": "fedcba9876543210"}', encoding="utf-8")
    assert [p["id"] for p in store.list_papers(OWNER)] == [pid]
    assert store.find_by_hash("h", "grad") == pid


def test_pages_cache_roundtrip():
    pid = store.new_id()
    assert store.load_pages(pid) is None
    store.save_pages(pid, ["Raw A"], ["raw a"])
    assert store.load_pages(pid) == (["Raw A"], ["raw a"])


def test_corrupt_pages_cache_is_ignored():
    pid = store.new_id()
    store.pages_path(pid).write_text("{broken", encoding="utf-8")
    assert store.load_pages(pid) is None


def test_get_pdf_bytes_and_local_pdf_url():
    pid = store.new_id()
    store.save_pdf(pid, b"%PDF-data")
    assert store.get_pdf_bytes(pid) == b"%PDF-data"
    assert store.pdf_url(pid) is None  # ローカルでは API から直接返す


def test_find_by_hash_matches_lang_and_treats_missing_lang_as_ja():
    old = store.new_id()
    store.save(_paper(old, sha256="h2", level="grad", status="done"))  # lang の無い古い記録
    en = store.new_id()
    store.save(_paper(en, sha256="h2", level="grad", lang="en", status="done"))
    assert store.find_by_hash("h2", "grad", "ja") == old
    assert store.find_by_hash("h2", "grad", "en") == en
    assert store.find_by_hash("h2", "grad") == old


def test_find_by_hash_skips_results_from_an_older_analysis_version():
    old = store.new_id()
    store.save({**_paper(old, sha256="h3", level="undergrad", status="done"), "analysis_version": config.ANALYSIS_VERSION - 1})
    legacy = store.new_id()
    legacy_record = _paper(legacy, sha256="h3", level="undergrad", status="done")
    del legacy_record["analysis_version"]  # 版の無い古い記録
    store.save(legacy_record)
    assert store.find_by_hash("h3", "undergrad") is None


def test_find_by_hash_prefers_the_newest_record():
    first = store.new_id()
    store.save(_paper(first, sha256="h4", level="undergrad", status="done", created_at="2026-11-01T00:00:00+00:00"))
    newest = store.new_id()
    store.save(_paper(newest, sha256="h4", level="undergrad", status="done", created_at="2026-11-08T00:00:00+00:00"))
    middle = store.new_id()
    store.save(_paper(middle, sha256="h4", level="undergrad", status="done", created_at="2026-11-05T00:00:00+00:00"))
    assert store.find_by_hash("h4", "undergrad") == newest


def test_find_by_hash_any_version_returns_the_newest_done_record_of_any_version():
    old = store.new_id()
    store.save({**_paper(old, sha256="h5", level="undergrad", status="done", created_at="2026-11-01T00:00:00+00:00"), "analysis_version": 1})
    newer = store.new_id()
    store.save({**_paper(newer, sha256="h5", level="undergrad", status="done", created_at="2026-11-02T00:00:00+00:00"), "analysis_version": 2})
    store.save(_paper(store.new_id(), sha256="h5", level="undergrad", status="failed", created_at="2026-11-03T00:00:00+00:00"))
    assert store.find_by_hash("h5", "undergrad", any_version=True) == newer
    assert store.find_by_hash("h5", "undergrad", "en", any_version=True) is None
