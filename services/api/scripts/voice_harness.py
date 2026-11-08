"""Scripted-call harness for the voice receptionist (audit V7).

Plays scripted caller conversations against a VOXERA API's live brain, the way the Voice lab
does, and reports per turn: client-side time to first text and total time, the server's own
metrics (rounds, uncached/cached/output tokens, time to first text, tool time) and the tools used.
Each scenario runs on its own synthetic workspace, which is deleted afterwards.

Modes:
  --mode fake   against stand-in providers (scripts/fake_providers.py). Checks the plumbing,
                the event stream and the metrics; scenario expectations are not evaluated,
                because the stand-in does not reason.
  --mode paid   against a real model. Every turn costs money, so it also needs --paid-approved,
                and a hard --max-turns limit applies. Run only with the owner's approval.

Never runs against production. Prints no credentials.
Usage: python scripts/voice_harness.py --api http://127.0.0.1:8000 --mode fake --out report.json
"""

from __future__ import annotations

import argparse
import json
import math
import secrets
import sys
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

import httpx

PRODUCTION_HOSTS = {"voxera-api-two.vercel.app", "voxera-api-ai-e399.vercel.app"}
SCENARIOS = Path(__file__).with_name("voice_scenarios.json")


class HarnessError(Exception):
    pass


def check_target(api: str) -> None:
    """Refuses production and anything that is not plain HTTP(S)."""
    parts = urlsplit(api)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise HarnessError("--api must be an http(s) URL")
    if parts.hostname in PRODUCTION_HOSTS or "confident-shannon" in parts.hostname:
        raise HarnessError("Refusing to run against production")


def parse_sse(body: str) -> list[dict]:
    """The brain's server-sent events (one JSON object per `data:` line)."""
    out = []
    for line in body.splitlines():
        if line.startswith("data: "):
            try:
                out.append(json.loads(line[6:]))
            except ValueError:
                out.append({"type": "malformed"})
    return out


def percentile(values: list[float], p: float) -> float | None:
    """Nearest-rank percentile; None when there is nothing to measure."""
    vals = sorted(v for v in values if v is not None)
    if not vals:
        return None
    k = max(0, min(len(vals) - 1, math.ceil(p / 100 * len(vals)) - 1))
    return vals[k]


@dataclass
class TurnResult:
    caller: str
    reply: str = ""
    tools: list[str] = field(default_factory=list)
    outcome: str = "done"  # done | error | broken
    error: str | None = None
    client_first_text_ms: int | None = None
    client_total_ms: int = 0
    server: dict = field(default_factory=dict)  # the done event's metrics


@dataclass
class ScenarioResult:
    name: str
    turns: list[TurnResult] = field(default_factory=list)
    checks: list[dict] = field(default_factory=list)  # {"check", "ok", "detail"}

    @property
    def ok(self) -> bool:
        return all(c["ok"] for c in self.checks)


def evaluate(scenario: dict, turns: list[TurnResult], mode: str) -> list[dict]:
    """Plumbing checks always; behaviour expectations only against a real model."""
    checks = []
    for i, t in enumerate(turns):
        checks.append({"check": f"turn {i + 1} ended cleanly", "ok": t.outcome == "done", "detail": t.error or ""})
        if t.outcome == "done":
            have = {"rounds", "input_tokens", "cache_read_tokens", "output_tokens", "first_text_ms"} <= t.server.keys()
            checks.append({"check": f"turn {i + 1} reported metrics", "ok": have, "detail": ""})
    if mode != "paid":
        return checks
    expect = scenario.get("expect", {})
    used = {name for t in turns for name in t.tools}
    said = " ".join(t.reply for t in turns).lower()
    for tool in expect.get("tools_used", []):
        checks.append({"check": f"used {tool}", "ok": tool in used, "detail": ", ".join(sorted(used))})
    for tool in expect.get("tools_not_used", []):
        checks.append({"check": f"did not use {tool}", "ok": tool not in used, "detail": ", ".join(sorted(used))})
    for words in expect.get("reply_includes", []):
        checks.append({"check": f"said '{words}'", "ok": words.lower() in said, "detail": ""})
    for words in expect.get("reply_excludes", []):
        checks.append({"check": f"did not say '{words}'", "ok": words.lower() not in said, "detail": ""})
    return checks


class Client:
    def __init__(self, api: str) -> None:
        self.http = httpx.Client(base_url=api.rstrip("/"), timeout=httpx.Timeout(90.0, connect=10.0))
        self.token = ""

    def call(self, method: str, path: str, body: dict | None = None) -> httpx.Response:
        headers = {"authorization": f"Bearer {self.token}"} if self.token else {}
        return self.http.request(method, path, json=body, headers=headers)


def setup_workspace(c: Client, business: dict, password: str) -> str:
    email = f"harness-{uuid.uuid4().hex[:10]}@voice-harness.example"
    r = c.call(
        "POST",
        "/v1/auth/signup",
        {"email": email, "password": password, "full_name": "Voice Harness", "organization_name": business["name"]},
    )
    if r.status_code != 201:
        raise HarnessError(f"sign-up failed ({r.status_code})")
    c.token = r.json()["access_token"]
    org = c.call("GET", "/v1/me/organizations").json()[0]["organization"]["id"]
    c.call(
        "PUT",
        f"/v1/orgs/{org}/business-profile",
        {"display_name": business["name"], "city": business.get("city", "Bristol")},
    )
    if business.get("hours"):
        c.call("PUT", f"/v1/orgs/{org}/office-hours", {"intervals": business["hours"]})
    for s in business.get("services", []):
        c.call("POST", f"/v1/orgs/{org}/services", s)
    return org


def run_turn(c: Client, org: str, history: list[dict], conversation_id: str) -> TurnResult:
    t = TurnResult(caller=history[-1]["text"])
    body = {"request_id": f"h-{uuid.uuid4().hex[:16]}", "conversation_id": conversation_id, "messages": history}
    started = time.monotonic()
    with c.http.stream(
        "POST", f"/v1/orgs/{org}/live/brain", json=body, headers={"authorization": f"Bearer {c.token}"}
    ) as r:
        if r.status_code != 200:
            r.read()
            t.outcome, t.error = "error", f"HTTP {r.status_code}"
            t.client_total_ms = int((time.monotonic() - started) * 1000)
            return t
        raw = ""
        for chunk in r.iter_text():
            if t.client_first_text_ms is None and '"type": "text"' in chunk:
                t.client_first_text_ms = int((time.monotonic() - started) * 1000)
            raw += chunk
    t.client_total_ms = int((time.monotonic() - started) * 1000)
    events = parse_sse(raw)
    for e in events:
        if e.get("type") == "text":
            t.reply += e.get("text", "")
        elif e.get("type") == "tool":
            t.tools.append(e.get("name", "?"))
        elif e.get("type") == "error":
            t.outcome, t.error = "error", e.get("message")
        elif e.get("type") == "done":
            t.server = e.get("metrics") or {}
    if not events or events[-1].get("type") not in ("done", "error"):
        t.outcome, t.error = "broken", "stream ended without done or error"
    return t


def run_scenario(c: Client, scenario: dict, business: dict, mode: str) -> ScenarioResult:
    password = secrets.token_urlsafe(24)
    res = ScenarioResult(name=scenario["name"])
    org = setup_workspace(c, business, password)
    try:
        history: list[dict] = []
        conversation_id = f"hc-{uuid.uuid4().hex[:16]}"
        for line in scenario["caller"]:
            history.append({"role": "user", "text": line})
            turn = run_turn(c, org, history, conversation_id)
            res.turns.append(turn)
            if turn.outcome != "done":
                break
            history.append({"role": "assistant", "text": turn.reply.strip() or "(no reply)"})
        res.checks = evaluate(scenario, res.turns, mode)
    finally:
        deleted = c.call("DELETE", "/v1/me", {"password": password}).status_code
        res.checks.append({"check": "synthetic workspace deleted", "ok": deleted == 204, "detail": str(deleted)})
    return res


def summarise(results: list[ScenarioResult]) -> dict:
    turns = [t for r in results for t in r.turns if t.outcome == "done"]
    server_first = [t.server.get("first_text_ms") for t in turns]
    read = sum(t.server.get("cache_read_tokens", 0) for t in turns)
    uncached = sum(t.server.get("input_tokens", 0) for t in turns)
    write = sum(t.server.get("cache_write_tokens", 0) for t in turns)
    return {
        "scenarios": len(results),
        "scenarios_passed": sum(r.ok for r in results),
        "turns": sum(len(r.turns) for r in results),
        "turns_ok": len(turns),
        "client_first_text_ms": {
            "p50": percentile([t.client_first_text_ms for t in turns], 50),
            "p95": percentile([t.client_first_text_ms for t in turns], 95),
        },
        "server_first_text_ms": {"p50": percentile(server_first, 50), "p95": percentile(server_first, 95)},
        "client_total_ms": {
            "p50": percentile([t.client_total_ms for t in turns], 50),
            "p95": percentile([t.client_total_ms for t in turns], 95),
        },
        "tokens": {
            "uncached_input": uncached,
            "cache_read": read,
            "cache_write": write,
            "output": sum(t.server.get("output_tokens", 0) for t in turns),
        },
        "cache_read_share": round(read / (read + uncached + write), 3) if (read + uncached + write) else None,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--api", required=True)
    ap.add_argument("--mode", choices=["fake", "paid"], required=True)
    ap.add_argument("--paid-approved", action="store_true", help="required with --mode paid")
    ap.add_argument("--max-turns", type=int, default=30, help="hard limit on caller turns across all scenarios")
    ap.add_argument("--scenarios", type=Path, default=SCENARIOS)
    ap.add_argument("--only", help="run one scenario by name")
    ap.add_argument("--out", type=Path, default=Path("voice-harness-report.json"))
    a = ap.parse_args(argv)
    check_target(a.api)
    if a.mode == "paid" and not a.paid_approved:
        raise HarnessError("--mode paid spends money: add --paid-approved only with the owner's approval")
    spec = json.loads(a.scenarios.read_text())
    scenarios = [s for s in spec["scenarios"] if not a.only or s["name"] == a.only]
    planned = sum(len(s["caller"]) for s in scenarios)
    if planned > a.max_turns:
        raise HarnessError(f"{planned} caller turns planned, more than --max-turns {a.max_turns}")
    c = Client(a.api)
    results = [run_scenario(c, s, spec["business"], a.mode) for s in scenarios]
    report = {
        "api_host": urlsplit(a.api).hostname,
        "mode": a.mode,
        "summary": summarise(results),
        "scenarios": [
            {"name": r.name, "ok": r.ok, "checks": r.checks, "turns": [asdict(t) for t in r.turns]} for r in results
        ],
    }
    a.out.write_text(json.dumps(report, indent=2))
    for r in results:
        print(f"{'PASS' if r.ok else 'FAIL'}  {r.name}")
        for ch in r.checks:
            if not ch["ok"]:
                print(f"        {ch['check']}  — {ch['detail']}")
    print(json.dumps(report["summary"], indent=2))
    if a.mode == "fake":
        print("Stand-in providers: timings and cache figures show the plumbing, not real performance.")
    return 0 if all(r.ok for r in results) else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except HarnessError as e:
        print(f"voice_harness: {e}", file=sys.stderr)
        sys.exit(2)
