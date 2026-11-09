"""Country profiles drive the receptionist's currency and emergency wording (ADR-0006 §7)."""

from app.live.receptionist import BusinessContext, system_prompt
from app.voice.regions import GENERIC, PROFILES, country_of, profile_for

from .test_live import live  # noqa: F401  (fixture)


def prompt(locale):
    return system_prompt(BusinessContext(name="Halden", greeting="", disclosure=None, locale=locale))


def test_uk_wording_is_kept():
    p = prompt("en-GB")
    assert "a UK business" in p and "British English" in p
    assert "call 999, or call NHS 111" in p and '"forty-five pounds"' in p


def test_other_countries_get_their_own_currency_and_emergency_numbers():
    p = prompt("en-IN")
    assert "a business in India" in p and "call 112" in p and "rupees" in p
    assert "999" not in p and "NHS" not in p and "pounds" not in p
    assert "998 for an ambulance" in prompt("ar-AE")


def test_an_unknown_country_never_gets_a_guessed_number():
    p = prompt("fr-FR")
    assert "your local emergency number" in p
    assert not any(n in p for n in ("999", "112", "911", "NHS"))
    assert profile_for("xx") is GENERIC and profile_for(None) is GENERIC


def test_no_emergency_number_is_marked_verified_before_a_launch_review():
    assert PROFILES and not any(p.verified for p in PROFILES.values())


def test_locale_parsing():
    assert country_of("en-GB") == "GB" and country_of("ar-ae") == "AE" and country_of("en") is None


def test_services_report_the_currency(make_account):
    a = make_account("ada@example.com")
    a.post(a.o("/services"), json={"name": "Cut", "duration_min": 45, "price_from_pence": 4500})
    from app.db import SessionLocal, set_tenant
    from app.live.receptionist import load_context

    with SessionLocal() as db:
        import uuid

        set_tenant(db, org_id=uuid.UUID(a.org_id), user_id=uuid.UUID(a.user_id))
        ctx = load_context(db, uuid.UUID(a.org_id))
    assert ctx.services[0]["price_from"] == "45.00" and ctx.services[0]["currency"] == "GBP"
    assert ctx.locale == "en-GB"


def test_emergency_numbers_follow_the_business_country_not_the_caller_language(make_account, live):  # noqa: F811
    import json

    from .test_live import message, setup_business

    a = make_account("ada@example.com")
    setup_business(a)
    assert a.patch(a.o("/settings"), json={"locale": "ar-AE"}).status_code == 200
    reply = message([("text", {"parts": ["…"]})], "end_turn", 20, 2)
    live["llm"] = [(200, reply), (200, reply)]
    for rid, lang in (("emerg-ar-0001", "ar-AE"), ("emerg-hi-0001", "hi-IN")):
        body = {"request_id": rid, "language": lang, "messages": [{"role": "user", "text": "help"}]}
        assert a.post(a.o("/live/brain"), json=body).status_code == 200
    prompts = [json.loads(r.content)["system"][0]["text"] for r in live["llm_requests"]]
    for p in prompts:  # same business (UAE) whatever the caller speaks
        assert "998 for an ambulance" in p and "NHS" not in p


# ---- launch gate --------------------------------------------------------------------------------


def test_no_country_is_ready_for_real_callers_yet():
    from app.voice import launch

    assert launch.SIGN_OFFS == {}
    for row in launch.status():
        assert not row["ready"] and len(row["blockers"]) == len(launch.CHECKS)


def test_a_country_is_ready_only_when_every_check_is_signed_off(monkeypatch):
    from app.voice import launch

    full = tuple(launch.SignOff(c, "owner", "2026-12-01", f"doc://{c}") for c in launch.CHECKS)
    monkeypatch.setitem(launch.SIGN_OFFS, "GB", full[:-1])
    assert launch.blockers("GB") == [launch.CHECKS["language_tested"]]
    monkeypatch.setitem(launch.SIGN_OFFS, "GB", full)
    assert launch.ready("GB")
    incomplete = (launch.SignOff("telephony", "owner", "2026-12-01", ""),)  # no evidence: does not count
    monkeypatch.setitem(launch.SIGN_OFFS, "IN", incomplete)
    assert launch.CHECKS["telephony"] in launch.blockers("IN")


def test_an_unknown_country_also_needs_a_profile():
    from app.voice import launch

    assert launch.blockers("FR")[0].startswith("No country profile")
