"""The workspace's saved voice policy (GET /v1/worker/voice/policy, API migration 0012).

The worker accepts exactly the languages the workspace allows, read from the API with the call's
worker token (the workspace comes from the token). There is no environment-variable fallback: if
the policy cannot be read, the call is refused before any record is opened or anything is said.

``called_number`` reads the number the caller dialled from a LiveKit SIP participant, so the API
can check that the number belongs to the token's workspace before a telephone call is recorded.
"""

from __future__ import annotations

import re

import httpx

E164 = re.compile(r"^\+[1-9][0-9]{6,14}$")
LOCALE = re.compile(r"^[a-z]{2,3}-[A-Z]{2}$")
SIP_TRUNK_NUMBER = "sip.trunkPhoneNumber"  # LiveKit SIP participant attribute: the number dialled


class PolicyUnavailable(Exception):
    """The workspace's voice policy could not be read or is malformed. Never contains a token."""


async def fetch_languages(api: str, tokens, http: httpx.AsyncClient | None = None) -> tuple[str, tuple[str, ...]]:
    """(default language, accepted languages) for the token's workspace."""
    url = f"{api.rstrip('/')}/v1/worker/voice/policy"
    client = http or httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0))
    try:
        token = await tokens.get()
        r = await client.get(url, headers={"authorization": f"Bearer {token}"})
        if r.status_code == 401:  # expired between the check and the request: refresh once
            token = await tokens.refresh(stale=token)
            r = await client.get(url, headers={"authorization": f"Bearer {token}"})
        if r.status_code != 200:
            raise PolicyUnavailable(f"voice policy request refused ({r.status_code})")
        body = r.json()
    except PolicyUnavailable:
        raise
    except Exception as e:  # noqa: BLE001 — any failure means no policy, so no call
        raise PolicyUnavailable(f"voice policy unavailable ({type(e).__name__})") from None
    finally:
        if http is None:
            await client.aclose()
    languages = body.get("languages") if isinstance(body, dict) else None
    default = body.get("default_language") if isinstance(body, dict) else None
    if (
        not isinstance(languages, list)
        or not languages
        or not all(isinstance(x, str) and LOCALE.fullmatch(x) for x in languages)
        or default not in languages
    ):
        raise PolicyUnavailable("voice policy malformed")
    # The default first, so a call starts in the workspace's default language.
    ordered = (default, *(x for x in languages if x != default))
    return default, ordered


def called_number(participant: object) -> str | None:
    """The dialled number in E.164 from a SIP participant's attributes, or None."""
    attrs = getattr(participant, "attributes", None) or {}
    raw = attrs.get(SIP_TRUNK_NUMBER) if isinstance(attrs, dict) else None
    if not isinstance(raw, str):
        return None
    n = re.sub(r"[ ()-]", "", raw)
    if n and not n.startswith("+") and n.isdigit():
        n = "+" + n  # some trunks omit the plus on an international number
    return n if E164.fullmatch(n) else None
