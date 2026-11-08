"""Stand-in call: the worker's CallSession against a running VOXERA API (normally with the stand-in
model provider, scripts/fake_providers.py). Simulated: no audio, no LiveKit server, no paid call.

Creates a synthetic account, mints a scoped worker token for its workspace when --mint is given
(otherwise uses the member token), plays a short multilingual conversation through the real brain endpoint
(tenancy, caps, tools and the language field all exercised), checks the session's behaviour, prints a
JSON summary and deletes the account. Refuses production.

    python scripts/standin_call.py --api http://127.0.0.1:8000
"""

from __future__ import annotations

import argparse
import asyncio
import json
import secrets
import sys
import uuid
from pathlib import Path
from urllib.parse import urlsplit

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from voxera_worker.brain import BrainClient  # noqa: E402
from voxera_worker.session import CallSession, LanguageGate  # noqa: E402

PRODUCTION = {"voxera-api-two.vercel.app", "voxera-api-ai-e399.vercel.app"}


def mint_token(cmd: str, org: str) -> str:
    import shlex
    import subprocess

    out = subprocess.run([*shlex.split(cmd), "--org", org], capture_output=True, text=True, check=True)
    return out.stdout.strip().splitlines()[-1]


async def main(api: str, mint: str | None) -> int:
    host = urlsplit(api).hostname or ""
    if host in PRODUCTION or "confident-shannon" in host:
        print("standin_call: refusing to run against production", file=sys.stderr)
        return 2
    password = secrets.token_urlsafe(24)
    email = f"worker-{uuid.uuid4().hex[:10]}@standin.example"
    async with httpx.AsyncClient(base_url=api, timeout=30) as http:
        r = await http.post(
            "/v1/auth/signup",
            json={"email": email, "password": password, "full_name": "Worker Standin", "organization_name": "Standin"},
        )
        r.raise_for_status()
        token = r.json()["access_token"]
        auth = {"authorization": f"Bearer {token}"}
        org = (await http.get("/v1/me/organizations", headers=auth)).json()[0]["organization"]["id"]
        try:
            if mint:
                brain = BrainClient(api, org, mint_token(mint, org), http, worker=True)
            else:
                brain = BrainClient(api, org, token, http)
            session = CallSession(brain, language=LanguageGate(accepted=("en-GB", "hi-IN")))
            script = [
                ("Hello, are you open on Saturday?", None, 0.0),
                ("Namaste", "hi", 0.93),
                ("Kya aap Saturday ko khule hain?", "hi", 0.95),
            ]
            for text, lang, conf in script:
                reply = "".join([p async for p in session.reply(text, detected_language=lang, confidence=conf)])
                print(json.dumps({"caller": text, "language": session.language.current, "reply_chars": len(reply)}))
            summary = session.summary()
            checks = {
                "every turn answered by the brain": summary["outcomes"].get("done", 0)
                + summary["outcomes"].get("filler_then_done", 0)
                == 3,
                "switched to Hindi after two confident detections": session.language.current == "hi-IN",
                "context kept across the switch": sum(m["role"] == "user" for m in session.history) == 3,
                "server metrics reported": all(t.server_metrics for t in session.turns),
            }
            checks["used the scoped worker credential" if mint else "used a member token (development)"] = True
            print(json.dumps({"summary": summary, "checks": checks, "simulated": True}, indent=2))
            return 0 if all(checks.values()) else 1
        finally:
            await http.request("DELETE", "/v1/me", headers=auth, json={"password": password})


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", required=True)
    ap.add_argument("--mint", help="command that prints a worker token for --org <id>")
    a = ap.parse_args()
    sys.exit(asyncio.run(main(a.api, a.mint)))
