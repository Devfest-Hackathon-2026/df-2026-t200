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
