from datetime import date

from rag.limits import DailyBudget, RateLimiter


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


def test_rate_limiter_allows_limit_per_window_per_key():
    clock = Clock()
    limiter = RateLimiter(2, window=60, clock=clock)
    assert limiter.allow("a") and limiter.allow("a")
    assert not limiter.allow("a")
    assert limiter.allow("b")  # other keys are counted separately


def test_rate_limiter_window_slides():
    clock = Clock()
    limiter = RateLimiter(2, window=60, clock=clock)
    limiter.allow("a")
    clock.now = 30
    limiter.allow("a")
    clock.now = 59.9
    assert not limiter.allow("a")
    clock.now = 60  # the first call has left the window, the second hasn't
    assert limiter.allow("a")
    assert not limiter.allow("a")


def test_zero_limits_mean_unlimited():
    assert all(RateLimiter(0).allow("a") for _ in range(100))
    assert all(DailyBudget(0).try_spend() for _ in range(100))


def test_daily_budget_resets_on_a_new_day():
    day = [date(2026, 1, 1)]
    budget = DailyBudget(1, today=lambda: day[0])
    assert budget.try_spend()
    assert not budget.try_spend()
    day[0] = date(2026, 1, 2)
    assert budget.try_spend()
