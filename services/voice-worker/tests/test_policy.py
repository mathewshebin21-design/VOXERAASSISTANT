"""Reading the workspace's saved voice policy, and the dialled number from a SIP participant."""

from types import SimpleNamespace

import httpx
import pytest

from voxera_worker.policy import PolicyUnavailable, called_number, fetch_languages


class Tokens:
    def __init__(self):
        self.refreshed = 0

    async def get(self):
        return "tok-1"

    async def refresh(self, stale=None):
        self.refreshed += 1
        return "tok-2"


def client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_reads_the_saved_languages_with_the_default_first():
    seen = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append((req.url.path, req.headers["authorization"]))
        return httpx.Response(200, json={"default_language": "hi-IN", "languages": ["en-GB", "hi-IN"]})

    assert await fetch_languages("http://api.test/", Tokens(), client(handler)) == ("hi-IN", ("hi-IN", "en-GB"))
    assert seen == [("/v1/worker/voice/policy", "Bearer tok-1")]


async def test_an_expired_token_is_refreshed_once():
    tokens = Tokens()

    def handler(req: httpx.Request) -> httpx.Response:
        if req.headers["authorization"] == "Bearer tok-1":
            return httpx.Response(401)
        return httpx.Response(200, json={"default_language": "en-GB", "languages": ["en-GB"]})

    assert await fetch_languages("http://api.test", tokens, client(handler)) == ("en-GB", ("en-GB",))
    assert tokens.refreshed == 1


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(403),
        httpx.Response(404),
        httpx.Response(500),
        httpx.Response(200, json={"languages": []}),
        httpx.Response(200, json={"default_language": "fr-FR", "languages": ["en-GB"]}),
        httpx.Response(200, json={"default_language": "en-GB", "languages": ["en-GB", "<script>"]}),
        httpx.Response(200, json=["en-GB"]),
        httpx.Response(200, content=b"not json"),
    ],
)
async def test_anything_but_a_valid_policy_refuses_the_call(response):
    with pytest.raises(PolicyUnavailable):
        await fetch_languages("http://api.test", Tokens(), client(lambda req: response))


async def test_a_network_failure_refuses_the_call_without_leaking_the_token():
    def handler(req):
        raise httpx.ConnectError("boom")

    with pytest.raises(PolicyUnavailable) as e:
        await fetch_languages("http://api.test", Tokens(), client(handler))
    assert "tok-" not in str(e.value)


@pytest.mark.parametrize(
    ("attrs", "expected"),
    [
        ({"sip.trunkPhoneNumber": "+441179460000"}, "+441179460000"),
        ({"sip.trunkPhoneNumber": "+44 117 946 0000"}, "+441179460000"),
        ({"sip.trunkPhoneNumber": "441179460000"}, "+441179460000"),
        ({"sip.trunkPhoneNumber": "01179460000"}, None),  # national format: not E.164
        ({"sip.trunkPhoneNumber": "sip:alice@example"}, None),
        ({}, None),
        (None, None),
    ],
)
def test_called_number_is_e164_or_nothing(attrs, expected):
    assert called_number(SimpleNamespace(attributes=attrs)) == expected
