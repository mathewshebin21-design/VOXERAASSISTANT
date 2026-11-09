"""Call-record housekeeping: delete calls past their workspace's retention period and mark
calls with no activity for two hours as abandoned.

    python scripts/call_housekeeping.py [--limit 1000]

Runs as the runtime role (VOXERA_DATABASE_URL) through the SECURITY DEFINER function
``call_housekeeping`` (migration 0011), so it needs no owner credentials and sees no rows itself.
Prints counts only. Meant for a scheduled job; scheduling it in production needs the owner's approval.
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text  # noqa: E402

from app.db import engine  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=1000, help="most calls to purge, and to abandon, in one run")
    a = ap.parse_args(argv)
    with engine.begin() as conn:
        purged, abandoned = conn.execute(
            text("SELECT purged, abandoned FROM call_housekeeping(:n)"), {"n": a.limit}
        ).one()
    print(json.dumps({"purged": purged, "abandoned": abandoned}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
