"""Fail-closed startup preflight for the isolated, no-telephone staging worker.

Only validates configuration: no network connections, token minting, or providers.
The staging container uses this as its entrypoint. Live SIP service needs a
separate reviewed production launch path, not a changed flag in staging.
"""

from __future__ import annotations

import os
import sys
from collections.abc import Mapping
from urllib.parse import urlsplit

PRODUCTION_API_HOSTS = frozenset(
    {
        "voxera-api-two.vercel.app",
        "voxera-api-ai-e399.vercel.app",
    }
)


def _host(url: str, scheme: str) -> str | None:
    try:
        parsed = urlsplit(url)
        if (
            parsed.scheme != scheme
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
            or parsed.path not in ("", "/")
            or parsed.port not in (None, 443)
        ):
            return None
        return parsed.hostname.lower()
    except ValueError:
        return None


def staging_errors(env: Mapping[str, str]) -> list[str]:
    errors: list[str] = []
    if env.get("VOXERA_WORKER_ENV") != "staging":
        errors.append("worker environment must be staging")
    if env.get("VOXERA_SIP_ENABLED") != "false":
        errors.append("staging SIP must be explicitly disabled")
    if env.get("VOXERA_MEDIA_ENABLED", "false") != "false":
        errors.append("staging paid speech inference must remain disabled")

    api_host = _host(env.get("VOXERA_API_URL", ""), "https")
    expected_api = env.get("VOXERA_STAGING_API_HOST", "").strip().lower()
    if (
        not api_host
        or not expected_api
        or api_host != expected_api
        or api_host in PRODUCTION_API_HOSTS
        or api_host.endswith(".localhost")
    ):
        errors.append("staging API HTTPS host mismatch or production alias")

    lk_host = _host(env.get("LIVEKIT_URL", ""), "wss")
    expected_lk = env.get("VOXERA_STAGING_LIVEKIT_HOST", "").strip().lower()
    if not lk_host or not expected_lk or lk_host != expected_lk:
        errors.append("staging LiveKit WSS host mismatch")

    if not env.get("LIVEKIT_API_KEY") or not env.get("LIVEKIT_API_SECRET"):
        errors.append("LiveKit credentials missing")
    if not env.get("VOXERA_WORKER_TOKEN_CMD") or env.get("VOXERA_WORKER_TOKEN"):
        errors.append("rotating worker token command required; static token forbidden")
    return errors


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in ("check", "start"):
        print("usage: python -m voxera_worker.launch_staging check|start", file=sys.stderr)
        return 2
    errors = staging_errors(os.environ)
    if errors:
        # Never log credentials or full URLs.
        print("staging worker refused: " + "; ".join(errors), file=sys.stderr)
        return 2
    if sys.argv[1] == "check":
        print("staging worker preflight OK (no network connection made)")
        return 0
    os.execv(sys.executable, [sys.executable, "-m", "voxera_worker.livekit_agent", "start"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
