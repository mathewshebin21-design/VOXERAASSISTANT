"""Mint a scoped voice-worker token (ADR-0005 §3): one workspace, brain only, at most 15 minutes.

    VOXERA_WORKER_SECRET=… python scripts/mint_worker_token.py --org <workspace id> [--minutes 15]

Prints the token on stdout for the operator or the worker's supervisor to hand to the worker. The
token is a credential: do not log it or put it in a ticket.
"""

import argparse
import sys
import uuid
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import worker_auth  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--org", required=True, type=uuid.UUID)
    ap.add_argument("--minutes", type=int, default=15)
    ap.add_argument("--mode", choices=["test", "live"], default="test", help="live: real callers (launch-gated)")
    ap.add_argument("--channel", choices=["simulated", "phone"], default="simulated", help="phone requires --mode live")
    a = ap.parse_args(argv)
    try:
        print(worker_auth.mint(a.org, ttl=timedelta(minutes=a.minutes), mode=a.mode, channel=a.channel))
    except worker_auth.WorkerAuthError as e:
        print(f"mint_worker_token: {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
