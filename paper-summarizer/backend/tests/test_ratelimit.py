import threading

from app.ratelimit import RateLimiter


class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


def test_allows_up_to_limit_within_window_then_recovers():
    clock = Clock()
    rl = RateLimiter(2, 60, clock=clock)
    assert [rl.allow("a"), rl.allow("a"), rl.allow("a")] == [True, True, False]
    assert rl.allow("b") is True  # キーごとに数える
    clock.t = 60.1
    assert rl.allow("a") is True


def test_is_thread_safe():
    rl = RateLimiter(50, 60)
    results = []
    lock = threading.Lock()

    def hit():
        for _ in range(20):
            ok = rl.allow("k")
            with lock:
                results.append(ok)

    threads = [threading.Thread(target=hit) for _ in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results.count(True) == 50


def test_forgets_keys_that_are_no_longer_used():
    """使われなくなった論文の記録を残し続けない（長く動くプロセスでメモリが増え続けない）。"""
    clock = Clock()
    rl = RateLimiter(2, 60, clock=clock)
    for i in range(100):
        rl.allow(f"paper-{i}")
    clock.t = 61
    rl.allow("other")
    assert set(rl._hits) == {"other"}
