"""Client for the VOXERA receptionist brain (POST /v1/orgs/{org}/live/brain, server-sent events).

The worker never contains receptionist logic: prompts, tools, booking confirmation, tenancy and
spending caps all stay in the API (ADR-0005). This client only streams one turn and reports what
happened. With ``worker=True`` it uses the scoped worker endpoint and a worker token (one workspace,
brain only, at most 15 minutes; ADR-0005 §3); otherwise a member's token (development only). The
token is never logged.
"""

from __future__ import annotations

import json
import time
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

import httpx


class BrainError(Exception):
    """The brain could not answer this turn. The message is safe to log (no caller text, no secrets)."""


@dataclass
class TurnEvents:
    text: list[str] = field(default_factory=list)
    tools: list[dict] = field(default_factory=list)
    handoff: dict | None = None
    metrics: dict = field(default_factory=dict)
    first_text_ms: int | None = None


class BrainClient:
    def __init__(
        self, api: str, org_id: str, token: str, http: httpx.AsyncClient | None = None, *, worker: bool = False
    ) -> None:
        # A worker token names its workspace itself; the URL never chooses it.
        base = api.rstrip("/")
        self.url = f"{base}/v1/worker/live/brain" if worker else f"{base}/v1/orgs/{org_id}/live/brain"
        self._headers = {"authorization": f"Bearer {token}"}
        self.http = http or httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=5.0))

    async def stream(
        self, history: list[dict], conversation_id: str, language: str | None, out: TurnEvents
    ) -> AsyncIterator[str]:
        """Yields reply text as it arrives; records tools, hand-off and metrics in ``out``.
        Raises BrainError on HTTP errors, error events or a stream that ends without ``done``."""
        body: dict = {
            "request_id": f"w-{uuid.uuid4().hex[:16]}",
            "conversation_id": conversation_id,
            "messages": history[-40:],
        }
        if language:
            body["language"] = language
        started = time.monotonic()
        done = False
        async with self.http.stream("POST", self.url, json=body, headers=self._headers) as r:
            if r.status_code != 200:
                await r.aread()
                raise BrainError(f"brain HTTP {r.status_code}")
            async for line in r.aiter_lines():
                if not line.startswith("data: "):
                    continue
                try:
                    e = json.loads(line[6:])
                except ValueError:
                    continue
                kind = e.get("type")
                if kind == "text" and e.get("text"):
                    if out.first_text_ms is None:
                        out.first_text_ms = int((time.monotonic() - started) * 1000)
                    out.text.append(e["text"])
                    yield e["text"]
                elif kind == "tool":
                    out.tools.append({"name": e.get("name"), "ok": bool(e.get("ok"))})
                elif kind == "handoff":
                    out.handoff = {k: e.get(k) for k in ("outcome", "staff", "case")}
                elif kind == "error":
                    raise BrainError("brain reported an error")
                elif kind == "done":
                    out.metrics = e.get("metrics") or {}
                    done = True
        if not done:
            raise BrainError("brain stream ended without done")
