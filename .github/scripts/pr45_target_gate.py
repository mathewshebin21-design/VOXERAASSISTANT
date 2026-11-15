"""Identity gate for the approved PR45 staging clone. Never prints credentials."""
import os
from urllib.parse import parse_qsl, urlsplit

SOURCE_SHA = "102bf2cd13bdc8915503a7f0a59708f161f128e5"
REF = "refs/heads/codex/uk-india-release-candidate-20261116"
HOST = "ep-falling-darkness-zaoogbut.c-2.eu-west-2.aws.neon.tech"
PROJECT = "blue-night-16595257"
BRANCH = "br-shy-math-zaczmtq5"


def validate(env):
    if env.get("GITHUB_REF") != REF:
        raise ValueError("wrong source branch")
    if env.get("APPROVED_SOURCE_SHA") != SOURCE_SHA:
        raise ValueError("wrong application source revision")
    if env.get("VALIDATION_PROJECT_ID") != PROJECT or env.get("VALIDATION_BRANCH_ID") != BRANCH:
        raise ValueError("wrong validation identity")
    for key in ("DATABASE_URL_UNPOOLED", "DATABASE_URL"):
        try:
            p = urlsplit(env.get(key, ""))
            query = parse_qsl(p.query, strict_parsing=True)
            allowed = (HOST,) if key.endswith("UNPOOLED") else (HOST, HOST.replace(".c-2", "-pooler.c-2"))
            # Reject libpq host/service/options overrides and duplicate SSL parameters.
            valid = (
                p.scheme in ("postgres", "postgresql", "postgresql+psycopg")
                and p.hostname in allowed and p.port in (None, 5432)
                and p.path == "/neondb" and p.username == "neondb_owner"
                and bool(p.password) and not p.fragment
                and len(query) == len(dict(query))
                and dict(query).get("sslmode") in ("require", "verify-full")
                and set(dict(query)) <= {"sslmode", "channel_binding"}
                and dict(query).get("channel_binding", "require") == "require"
            )
        except (TypeError, ValueError):
            valid = False
        if not valid:
            raise ValueError("invalid isolated database connection")


if __name__ == "__main__":
    try:
        validate(os.environ)
    except ValueError as exc:
        raise SystemExit("STOP: " + str(exc)) from None
    print("PR45 source, branch and isolated database identifiers verified")
