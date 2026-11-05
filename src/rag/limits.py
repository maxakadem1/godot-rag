"""In-memory request limits for the API.

Kept in process memory, so they assume one API instance; with several instances each
would count separately and the limits would multiply. A shared store (e.g. Redis)
would fix that, but one instance is all this project needs.
"""

import threading
import time
from collections import deque
from collections.abc import Callable
from datetime import UTC, date, datetime


class RateLimiter:
    """At most `limit` calls per key in any `window` seconds (sliding window).
    limit <= 0 allows everything."""

    def __init__(
        self, limit: int, window: float = 60.0, clock: Callable[[], float] = time.monotonic
    ):
        self.limit, self.window, self.clock = limit, window, clock
        self._calls: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        if self.limit <= 0:
            return True
        now = self.clock()
        with self._lock:
            if len(self._calls) > 10_000:  # drop idle keys so memory stays bounded
                self._calls = {k: q for k, q in self._calls.items() if now - q[-1] < self.window}
            calls = self._calls.setdefault(key, deque())
            while calls and now - calls[0] >= self.window:
                calls.popleft()
            if len(calls) >= self.limit:
                return False
            calls.append(now)
            return True


def _utc_today() -> date:
    return datetime.now(UTC).date()


class DailyBudget:
    """A counter that allows `limit` spends per UTC day. limit <= 0 is unlimited."""

    def __init__(self, limit: int, today: Callable[[], date] = _utc_today):
        self.limit, self.today = limit, today
        self._day, self._spent = today(), 0
        self._lock = threading.Lock()

    def try_spend(self) -> bool:
        if self.limit <= 0:
            return True
        with self._lock:
            if (day := self.today()) != self._day:
                self._day, self._spent = day, 0
            if self._spent >= self.limit:
                return False
            self._spent += 1
            return True
