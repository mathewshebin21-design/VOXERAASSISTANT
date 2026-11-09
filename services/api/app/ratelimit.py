"""Rate limits shared by every API instance.

``PostgresLimiter`` (the default) keeps its counts in Postgres (migration 0010), so all
serverless instances count against the same limit. ``SlidingWindowLimiter`` keeps them in
process memory: it is only correct with a single instance, and remains as the documented
rollback (set ``VOXERA_RATE_LIMIT_BACKEND=memory``).

Bucket keys are HMAC-SHA256 digests of the caller's key (e.g. email and address), so the table
never holds an email address or IP address.

Fail closed: if the counter store cannot be reached, ``check`` raises ``LimiterUnavailable`` and
the caller refuses the request (HTTP 503) rather than letting it through uncounted.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import math
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.engine import Engine

log = logging.getLogger("voxera.ratelimit")


class LimiterUnavailable(Exception):
    """The shared counter store could not be reached; the request must be refused."""


@dataclass(frozen=True)
class Decision:
    allowed: bool
    retry_after: int  # seconds until the caller should try again (0 when allowed)


class SlidingWindowLimiter:
    """In-process sliding window. Correct for one instance only; kept as the rollback backend."""

    def __init__(self, limit: int, window_seconds: float = 60.0) -> None:
        self.limit, self.window = limit, window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str) -> Decision:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > self.window:
                q.popleft()
            if len(q) >= self.limit:
                return Decision(False, max(1, math.ceil(self.window - (now - q[0]))))
            q.append(now)
            return Decision(True, 0)

    def allow(self, key: str) -> bool:
        return self.check(key).allowed

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


class PostgresLimiter:
    """Sliding-window counter in Postgres: one atomic upsert per check (see migration 0010).

    Every attempt counts, including refused ones, so a caller who keeps trying stays limited.
    The estimate weights the previous window by how much of it still overlaps the rolling window,
    which is the usual sliding-window-counter approximation (exact within one window's hits).
    """

    def __init__(self, engine: Engine, name: str, limit: int, window_seconds: int, secret: bytes) -> None:
        if limit < 1 or not 1 <= window_seconds <= 86400:
            raise ValueError("invalid rate limit")
        self.engine, self.name, self.limit, self.window = engine, name, limit, window_seconds
        self._secret = secret

    def bucket(self, key: str) -> str:
        msg = f"{self.name}|{self.limit}|{self.window}|{key}".encode()
        return hmac.new(self._secret, msg, hashlib.sha256).hexdigest()

    def hit(self, key: str) -> tuple[int, int, float]:
        """Counts one attempt; returns (this window's hits, previous window's hits, elapsed fraction)."""
        try:
            with self.engine.begin() as conn:  # its own transaction: the hit stays counted if the request fails
                row = conn.execute(
                    text("SELECT current_hits, previous_hits, elapsed FROM rate_limit_hit(:b, :w)"),
                    {"b": self.bucket(key), "w": self.window},
                ).one()
        except Exception as e:
            log.error("rate limiter unavailable", extra={"limiter": self.name, "error": type(e).__name__})
            raise LimiterUnavailable from e
        return int(row[0]), int(row[1]), min(max(float(row[2]), 0.0), 1.0)

    def check(self, key: str) -> Decision:
        return self.decide(*self.hit(key))

    def decide(self, current: int, previous: int, elapsed: float) -> Decision:
        estimate = previous * (1.0 - elapsed) + current
        if estimate <= self.limit:
            return Decision(True, 0)
        return Decision(False, self._retry_after(current, previous, elapsed))

    def _retry_after(self, current: int, previous: int, elapsed: float) -> int:
        """Seconds until the estimate (without a new hit) falls back within the limit."""
        if current > self.limit:  # this window alone is over: wait for it to slide out (≤ 2 windows)
            return max(1, math.ceil(self.window * (2.0 - elapsed)))
        # Only the previous window's share keeps us over; it shrinks linearly through this window.
        needed = 1.0 - (self.limit - current) / previous  # elapsed fraction at which we fit again
        return max(1, math.ceil(self.window * (needed - elapsed)))

    def allow(self, key: str) -> bool:
        return self.check(key).allowed

    def reset(self) -> None:
        """Counts live in Postgres; tests clear the table as the owner role."""


Limiter = SlidingWindowLimiter | PostgresLimiter


def make_limiter(name: str, limit: int, window_seconds: int = 60) -> Limiter:
    from .config import get_settings
    from .db import engine

    s = get_settings()
    if s.rate_limit_backend == "memory":
        return SlidingWindowLimiter(limit, window_seconds)
    secret = hashlib.sha256(b"voxera-rate-limit|" + s.jwt_secret.get_secret_value().encode()).digest()
    return PostgresLimiter(engine, name, limit, window_seconds, secret)
