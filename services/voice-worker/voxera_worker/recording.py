"""Writes the worker's call into VOXERA's call records (POST /v1/worker/calls, migration 0011).

One writer per call: the worker records each finished turn in the order it was spoken (the caller's
words, tools, hand-offs, the brain's reply and the worker's own lines: filler, recovery, message-taking,
closing). It does not send ``call_id`` to the brain, so the server never writes the same turn twice.

Recording is best effort and never holds up the call: writes run in the background, one after another
(so sequence numbers follow speech), and after a failure the recorder stops rather than leave gaps it
cannot explain. The workspace and the channel come from the worker token; the API keeps the words only
if the recording notice was played. The token is never logged; neither is anything the caller said.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging

import httpx

from .tokens import StaticToken, TokenSource

log = logging.getLogger("voxera.worker.recording")

MAX_EVENTS_PER_WRITE = 50  # the API's limit per request


def room_ref(name: str | None) -> str | None:
    """A restart-safe call-record reference from the room name. Hashed, because a telephone room's
    name can contain the caller's number, which must not end up in a reference field."""
    if not name:
        return None
    return "room-" + hashlib.sha256(name.encode()).hexdigest()[:32]


class CallRecorder:
    def __init__(self, api: str, tokens: TokenSource | StaticToken, http: httpx.AsyncClient | None = None) -> None:
        self.base = f"{api.rstrip('/')}/v1/worker/calls"
        self.tokens = tokens
        self.http = http or httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0))
        self.call_id: str | None = None
        self.failed = False
        self._chain: asyncio.Task | None = None

    async def start(
        self,
        *,
        external_ref: str | None = None,
        caller_number: str | None = None,
        called_number: str | None = None,
        ai_disclosure_played: bool = False,
        recording_notice_played: bool = False,
    ) -> str | None:
        """Opens the call record (idempotent on ``external_ref``). Returns its id, or None if it failed.
        ``called_number`` (telephone calls only): the API records the call only if the number is
        assigned to the token's workspace."""
        body: dict = {"ai_disclosure_played": ai_disclosure_played, "recording_notice_played": recording_notice_played}
        if external_ref:
            body["external_ref"] = external_ref
        if caller_number:
            body["caller_number"] = caller_number
        if called_number:
            body["called_number"] = called_number
        r = await self._post(self.base, body, expect=(200, 201))
        if r is not None:
            self.call_id = r.json()["id"]
        return self.call_id

    def add(self, events: list[dict]) -> None:
        """Queues events behind earlier writes; returns at once."""
        if not events or self.call_id is None or self.failed:
            return
        prev = self._chain

        async def write() -> None:
            if prev is not None:
                await asyncio.gather(prev, return_exceptions=True)
            for i in range(0, len(events), MAX_EVENTS_PER_WRITE):
                if self.failed:
                    return
                url = f"{self.base}/{self.call_id}/events"
                await self._post(url, {"events": events[i : i + MAX_EVENTS_PER_WRITE]}, expect=(201,))

        self._chain = asyncio.create_task(write())

    async def end(self, status: str = "completed", outcome: str | None = None, reason: str | None = None) -> None:
        """Waits for queued writes, then closes the record (even if a write failed, so it is not left open)."""
        if self._chain is not None:
            await asyncio.gather(self._chain, return_exceptions=True)
        if self.call_id is None:
            return
        body: dict = {"status": status}
        if outcome:
            body["outcome"] = outcome
        if reason:
            body["reason"] = reason[:200]
        await self._post(f"{self.base}/{self.call_id}/end", body, expect=(200,), always=True)

    async def _post(
        self, url: str, body: dict, *, expect: tuple[int, ...], always: bool = False
    ) -> httpx.Response | None:
        if self.failed and not always:
            return None
        try:
            token = await self.tokens.get()
            r = await self.http.post(url, json=body, headers={"authorization": f"Bearer {token}"})
            if r.status_code == 401:  # expired between the check and the request: refresh once
                token = await self.tokens.refresh(stale=token)
                r = await self.http.post(url, json=body, headers={"authorization": f"Bearer {token}"})
        except Exception as e:  # noqa: BLE001 — recording must never break the call
            self.failed = True
            log.warning("call record write failed", extra={"error": type(e).__name__})
            return None
        if r.status_code not in expect:
            self.failed = True
            log.warning("call record write refused", extra={"status": r.status_code})
            return None
        return r
