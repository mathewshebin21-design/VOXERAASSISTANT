"""Validate the isolated RC-1 target without connecting or printing credentials."""
import os
from urllib.parse import urlsplit

HOST = "ep-wandering-hat-zatfukuw.c-2.eu-west-2.aws.neon.tech"


def validate(ref, connection):
    if ref != "refs/heads/codex/rc1-validation":
        raise ValueError("RC-1 validation branch required")
    try:
        url = urlsplit(connection)
        valid = (
            url.scheme in {"postgresql", "postgresql+psycopg"}
            and url.hostname == HOST
            and url.port in {None, 5432}
            and url.path == "/neondb"
            and bool(url.username)
            and bool(url.password)
            and not url.fragment
            and not url.query
        )
    except ValueError:
        valid = False
    if not valid:
        raise ValueError("RC-1 direct database credential is invalid")


if __name__ == "__main__":
    try:
        validate(os.getenv("GITHUB_REF", ""), os.getenv("DATABASE_URL_UNPOOLED", ""))
    except ValueError as error:
        raise SystemExit(str(error)) from None
    print("RC-1 branch and isolated database target verified")
