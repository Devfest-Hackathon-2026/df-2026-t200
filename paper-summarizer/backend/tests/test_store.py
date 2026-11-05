import threading

import pytest

from app import store


def _paper(pid, **kw):
    base = {"id": pid, "filename": "a.pdf", "status": "queued", "created_at": store.now(), "results": {}}
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
    items = store.list_papers()
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
