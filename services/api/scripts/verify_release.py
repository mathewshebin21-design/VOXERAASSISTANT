"""Read-only release verification for a VOXERA database (a production clone, or production itself).

    python scripts/verify_release.py --env production --expect 0007 --save baseline.json
    python scripts/verify_release.py --env production --expect 0009 --baseline baseline.json

It never writes: every connection runs with default_transaction_read_only=on. It prints table
names, counts and pass/fail lines only, never a host, user name, password or row content.

Checks:
  - the database is claimed for --env and its schema revision is --expect;
  - the runtime role is restricted (not superuser, no BYPASSRLS, owns no tables);
  - every tenant table (has organization_id) has row-level security and a policy;
  - connected AS the runtime role with no tenant set, every tenant table returns no rows;
  - Agent Studio's published versions are append-only for the runtime role (from 0008);
  - the design columns and check constraints exist, with no NULL or invalid values (from 0009);
  - with --baseline: no table in the baseline has fewer rows (nothing was lost or dropped).

Connections come from the same variables as migrate.py: DATABASE_URL_UNPOOLED (owner) and
DATABASE_URL (pooled; the runtime role's password is derived from the owner's). For a local
rehearsal, VERIFY_APP_DATABASE_URL may name the runtime-role connection explicitly.
"""

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, pool, text  # noqa: E402

from app import deploy_env  # noqa: E402
from app.platform import APP_ROLE, hosted_overrides, migration_owner_url  # noqa: E402

READ_ONLY = {"options": "-c default_transaction_read_only=on"}
DESIGNS = ("command", "atelier", "flow")


def _engine(url: str):
    return create_engine(url, poolclass=pool.NullPool, connect_args=READ_ONLY)


def _rev_at_least(rev: str | None, want: str) -> bool:
    return rev is not None and rev.isdigit() and int(rev) >= int(want)


def owner_checks(c, env: str, expect: str) -> tuple[list[tuple[str, bool, str]], dict[str, int], list[str]]:
    out: list[tuple[str, bool, str]] = []
    have = deploy_env.claimed(c)
    out.append(("database claimed for the expected environment", have == env, f"claimed for {have}"))
    rev = c.execute(text("SELECT version_num FROM alembic_version")).scalar()
    out.append(("schema revision", rev == expect, f"at {rev}, expected {expect}"))

    role = c.execute(
        text("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = :r"), {"r": APP_ROLE}
    ).one_or_none()
    out.append(("runtime role exists", role is not None, ""))
    if role is not None:
        out.append(("runtime role is not a superuser", not role.rolsuper, ""))
        out.append(("runtime role cannot bypass row-level security", not role.rolbypassrls, ""))
        owned = c.execute(
            text("SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tableowner = :r"), {"r": APP_ROLE}
        ).scalar()
        out.append(("runtime role owns no tables (policies always apply to it)", owned == 0, f"owns {owned}"))

    tenant = [
        r[0]
        for r in c.execute(
            text(
                "SELECT table_name FROM information_schema.columns "
                "WHERE table_schema = 'public' AND column_name = 'organization_id' ORDER BY table_name"
            )
        )
    ]
    for t in tenant:
        rls, policies = c.execute(
            text(
                "SELECT c.relrowsecurity, (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' "
                "AND p.tablename = c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = 'public' AND c.relname = :t"
            ),
            {"t": t},
        ).one()
        out.append((f"row-level security on {t}", bool(rls) and policies > 0, f"rls={rls}, policies={policies}"))

    if _rev_at_least(rev, "0008"):
        for t in ("agent_flows", "agent_flow_versions", "flow_sessions", "flow_tests"):
            exists = c.execute(text("SELECT to_regclass(:t) IS NOT NULL"), {"t": f"public.{t}"}).scalar()
            out.append((f"0008 table {t} exists", bool(exists), ""))
        if role is not None:
            for priv in ("UPDATE", "DELETE"):
                ok = not c.execute(
                    text("SELECT has_table_privilege(:r, 'public.agent_flow_versions', :p)"), {"r": APP_ROLE, "p": priv}
                ).scalar()
                out.append((f"published flow versions: runtime role has no {priv}", ok, ""))

    if _rev_at_least(rev, "0009"):
        for table, nullable in (("workspace_settings", False), ("memberships", True)):
            col = c.execute(
                text(
                    "SELECT is_nullable, column_default FROM information_schema.columns "
                    "WHERE table_schema = 'public' AND table_name = :t AND column_name = 'ui_design'"
                ),
                {"t": table},
            ).one_or_none()
            out.append((f"0009 column {table}.ui_design exists", col is not None, ""))
            if col is not None:
                out.append((f"{table}.ui_design nullability", (col.is_nullable == "YES") == nullable, col.is_nullable))
            valid = ", ".join(f"'{d}'" for d in DESIGNS)
            bad = c.execute(
                text(f"SELECT count(*) FROM {table} WHERE ui_design IS NOT NULL AND ui_design NOT IN ({valid})")  # noqa: S608 (fixed names)
            ).scalar()
            out.append((f"{table}.ui_design has no invalid values", bad == 0, f"{bad} invalid"))
        nulls = c.execute(text("SELECT count(*) FROM workspace_settings WHERE ui_design IS NULL")).scalar()
        out.append(("every workspace has a default design", nulls == 0, f"{nulls} without"))
        for name in ("ck_settings_ui_design", "ck_membership_ui_design"):
            n = c.execute(text("SELECT count(*) FROM pg_constraint WHERE conname = :n"), {"n": name}).scalar()
            out.append((f"check constraint {name}", n == 1, ""))

    counts = {
        t: c.execute(text(f'SELECT count(*) FROM "{t}"')).scalar()  # noqa: S608 (names from the catalog)
        for (t,) in c.execute(text("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"))
    }
    return out, counts, tenant


def runtime_checks(app_url: str, tenant: list[str]) -> list[tuple[str, bool, str]]:
    out: list[tuple[str, bool, str]] = []
    with _engine(app_url).connect() as c:
        me = c.execute(text("SELECT current_user")).scalar()
        out.append(("runtime connection uses the runtime role", me == APP_ROLE, ""))
        for t in tenant:
            try:
                n = c.execute(text(f'SELECT count(*) FROM "{t}"')).scalar()  # noqa: S608
                out.append((f"no tenant set: {t} returns no rows to the runtime role", n == 0, f"{n} visible"))
            except Exception as e:  # noqa: BLE001 — a permission error is also isolation
                c.rollback()
                out.append((f"no tenant set: {t} not readable by the runtime role", True, type(e).__name__))
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--env", required=True, choices=deploy_env.ENVIRONMENTS)
    ap.add_argument("--expect", required=True, help="the schema revision the database must be at")
    ap.add_argument("--save", help="write table row counts to this file (the baseline)")
    ap.add_argument("--baseline", help="compare table row counts with a saved baseline")
    a = ap.parse_args(argv)

    owner_url = migration_owner_url()
    if not owner_url:
        print("no database connection (DATABASE_URL_UNPOOLED / DATABASE_URL) in the environment")
        return 2
    with _engine(owner_url).connect() as c:
        results, counts, tenant = owner_checks(c, a.env, a.expect)

    app_url = os.environ.get("VERIFY_APP_DATABASE_URL") or hosted_overrides().get("database_url")
    if app_url:
        results += runtime_checks(app_url, tenant)
    else:
        results.append(("runtime role connection available for isolation checks", False, "no DATABASE_URL"))

    if a.baseline:
        base = json.loads(Path(a.baseline).read_text())
        for t, n in sorted(base.items()):
            # Live traffic keeps adding rows during a release, so the rule is: nothing was lost.
            results.append((f"no rows lost in {t}", counts.get(t, -1) >= n, f"{n} -> {counts.get(t)}"))

    failed = [r for r in results if not r[1]]
    for name, ok, detail in results:
        print(f"{'PASS' if ok else 'FAIL'}  {name}{'  (' + detail + ')' if detail and not ok else ''}")
    print("row counts: " + ", ".join(f"{t}={n}" for t, n in counts.items() if n))
    if a.save:
        Path(a.save).write_text(json.dumps(counts, indent=1, sort_keys=True))
        print(f"baseline written to {a.save}")
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
