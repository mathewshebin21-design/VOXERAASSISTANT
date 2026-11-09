"""Keeps a worker's short-lived brain token fresh (ADR-0005 §3).

Worker tokens last at most 15 minutes and a call can last longer, so the worker asks its supervisor
for a new token shortly before the current one expires, and once more if the API rejects it. The
token's expiry is read from its payload; the signature is checked by the API, never here. Tokens are
never logged.
"""

from __future__ import annotations

import asyncio
import base64
import json
import time
from collections.abc import Awaitable, Callable

Fetch = Callable[[], Awaitable[str]]


def expiry(token: str) -> float:
    """The token's ``exp`` claim (seconds since the epoch), or 0 if it cannot be read."""
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return float(json.loads(base64.urlsafe_b64decode(payload))["exp"])
    except (IndexError, ValueError, KeyError, TypeError):
        return 0.0


class TokenSource:
    """A token that refreshes itself ``margin`` seconds before it expires. One refresh at a time."""

    def __init__(self, fetch: Fetch, margin: float = 60.0, clock: Callable[[], float] = time.time) -> None:
        self._fetch, self.margin, self.clock = fetch, margin, clock
        self._token: str | None = None
        self._lock = asyncio.Lock()
        self.refreshes = 0

    async def get(self) -> str:
        if self._token is None or expiry(self._token) - self.clock() <= self.margin:
            await self.refresh(stale=self._token)
        assert self._token is not None
        return self._token

    async def refresh(self, stale: str | None = None) -> str:
        """Gets a new token, unless another task already replaced ``stale`` while we waited."""
        async with self._lock:
            if self._token is None or self._token == stale:
                token = await self._fetch()
                if expiry(token) <= self.clock():
                    raise RuntimeError("supervisor returned an expired or unreadable worker token")
                self._token, self.refreshes = token, self.refreshes + 1
            return self._token


class StaticToken:
    """A fixed token (development: a member's token, or a single worker token for a short test)."""

    def __init__(self, token: str) -> None:
        self._token = token

    async def get(self) -> str:
        return self._token

    async def refresh(self, stale: str | None = None) -> str:
        return self._token


def command_fetch(cmd: str) -> Fetch:
    """A supervisor command that prints a fresh worker token on stdout (e.g. mint_worker_token.py)."""
    import shlex

    async def fetch() -> str:
        proc = await asyncio.create_subprocess_exec(
            *shlex.split(cmd), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL
        )
        out, _ = await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError("worker token command failed")
        return out.decode().strip().splitlines()[-1]

    return fetch
