"""Validate explicit source and target confirmation before an isolated claim."""
import os
import re
from rc1_target import HOST, validate


def verify_confirmation(source, approved, host):
    if not re.fullmatch(r"[a-f0-9]{40}", source) or approved != source or host != HOST:
        raise ValueError("Exact approved source SHA and isolated host confirmation required")


if __name__ == "__main__":
    try:
        validate(os.getenv("GITHUB_REF", ""), os.getenv("DATABASE_URL_UNPOOLED", ""))
        verify_confirmation(os.getenv("GITHUB_SHA", ""), os.getenv("APPROVED_SHA", ""), os.getenv("CONFIRM_HOST", ""))
    except ValueError as error:
        raise SystemExit(str(error)) from None
