"""Assign telephone numbers to workspaces (migration 0012). Operator only.

    python scripts/phone_numbers.py --env staging list [--org <id>]
    python scripts/phone_numbers.py --env staging assign --org <id> --number +441179460000 [--label "Main line"]
    python scripts/phone_numbers.py --env staging disable --number +441179460000
    python scripts/phone_numbers.py --env staging enable --number +441179460000
    python scripts/phone_numbers.py --env staging resolve --number +441179460000

Uses the owner connection (DATABASE_URL_UNPOOLED / DATABASE_URL), because the API's runtime role may
only read its own workspace's numbers: no workspace can assign itself a number. ``--env`` must match
the environment the database is claimed for, so a command meant for staging cannot change production.

A number belongs to at most one workspace. ``assign`` refuses a number that is already assigned
anywhere; to move a number, disable it, have the owner of the old workspace agree, and reassign it
in a reviewed change. Every change writes an audit row in the affected workspace.

Assigning a number does not connect telephony: calls still need a live worker token for a
launch-ready country (app/voice/launch.py) and an approved SIP setup.
"""

import argparse
import json
import re
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, pool, select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app import audit, deploy_env  # noqa: E402
from app.models import Organization, PhoneNumber  # noqa: E402
from app.platform import migration_owner_url  # noqa: E402

E164 = re.compile(r"^\+[1-9][0-9]{6,14}$")


class Refused(Exception):
    pass


def _number(value: str) -> str:
    n = re.sub(r"[ ()-]", "", value)
    if not E164.fullmatch(n):
        raise argparse.ArgumentTypeError("use E.164, e.g. +441179460000")
    return n


def run(db: Session, env: str, a: argparse.Namespace) -> dict | list:
    have = deploy_env.claimed(db.connection())
    if have != env:
        raise Refused(f"this database is claimed for {have!r}, not {env!r}")
    if a.cmd == "list":
        q = select(PhoneNumber).order_by(PhoneNumber.e164)
        if a.org:
            q = q.where(PhoneNumber.organization_id == a.org)
        return [
            {"e164": n.e164, "org": str(n.organization_id), "status": n.status, "label": n.label} for n in db.scalars(q)
        ]
    if a.cmd == "resolve":
        n = db.scalar(select(PhoneNumber).where(PhoneNumber.e164 == a.number))
        return {"e164": a.number, "org": str(n.organization_id) if n else None, "status": n.status if n else None}
    if a.cmd == "assign":
        if db.get(Organization, a.org) is None:
            raise Refused("no such workspace")
        if db.scalar(select(PhoneNumber.id).where(PhoneNumber.e164 == a.number)) is not None:
            raise Refused("that number is already assigned; disable and reassign it in a reviewed change")
        n = PhoneNumber(id=uuid.uuid4(), organization_id=a.org, e164=a.number, status="active", label=a.label)
        db.add(n)
        audit.record(
            db, a.org, None, "phone_number.assigned", "phone_number", n.id, {"e164": a.number, "by": "operator"}
        )
        db.commit()
        return {"e164": a.number, "org": str(a.org), "status": "active"}
    # enable / disable
    n = db.scalar(select(PhoneNumber).where(PhoneNumber.e164 == a.number))
    if n is None:
        raise Refused("that number is not assigned")
    want = "active" if a.cmd == "enable" else "disabled"
    if n.status != want:
        n.status = want
        audit.record(
            db,
            n.organization_id,
            None,
            f"phone_number.{a.cmd}d",
            "phone_number",
            n.id,
            {"e164": n.e164, "by": "operator"},
        )
        db.commit()
    return {"e164": n.e164, "org": str(n.organization_id), "status": want}


def parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--env", required=True, choices=deploy_env.ENVIRONMENTS)
    sub = ap.add_subparsers(dest="cmd", required=True)
    ls = sub.add_parser("list")
    ls.add_argument("--org", type=uuid.UUID)
    asg = sub.add_parser("assign")
    asg.add_argument("--org", required=True, type=uuid.UUID)
    asg.add_argument("--number", required=True, type=_number)
    asg.add_argument("--label", default=None)
    for name in ("disable", "enable", "resolve"):
        sub.add_parser(name).add_argument("--number", required=True, type=_number)
    return ap


def main(argv: list[str] | None = None) -> int:
    a = parser().parse_args(argv)
    if a.cmd == "assign" and a.label is not None and len(a.label) > 80:
        print("phone_numbers: label is at most 80 characters", file=sys.stderr)
        return 2
    url = migration_owner_url()
    if not url:
        print("phone_numbers: no owner database connection (DATABASE_URL_UNPOOLED / DATABASE_URL)", file=sys.stderr)
        return 2
    engine = create_engine(url, poolclass=pool.NullPool)
    try:
        with Session(engine) as db:
            print(json.dumps(run(db, a.env, a), indent=2))
    except Refused as e:
        print(f"phone_numbers: refused: {e}", file=sys.stderr)
        return 3
    finally:
        engine.dispose()
    return 0


if __name__ == "__main__":
    sys.exit(main())
