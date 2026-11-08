"""Language registry, provider routing under workspace policy, and language-switching state (ADR-0006)."""

import pytest

from app.voice import languages as L
from app.voice.routing import (
    LanguageState,
    NoCompliantRoute,
    VoicePolicy,
    eligible,
    language_instruction,
    select_route,
)

from .test_live import live  # noqa: F401  (fixture)

ALL = frozenset({"device", "uk", "eu", "us", "global"})


def policy(**kw):
    base = {
        "default_language": "en-GB",
        "languages": ("en-GB", "hi-IN", "ml-IN", "ar-SA"),
        "fallback_language": "en-GB",
        "allowed_regions": ALL,
        "allow_paid": True,
    }
    return VoicePolicy(**{**base, **kw})


# ---- registry honesty ---------------------------------------------------------------------------


def test_nothing_claims_tested_support_before_a_real_run():
    assert all(s is not L.Support.tested for p in L.PROVIDERS.values() for s in p.languages.values())


def test_registry_uses_bcp47_locales_and_marks_rtl_scripts():
    for code, lang in L.LANGUAGES.items():
        assert code == lang.code and len(code.split("-")) == 2 and code.split("-")[1].isupper()
    assert L.language("ar-SA").rtl and not L.language("hi-IN").rtl


def test_locale_specific_support_beats_the_base_language():
    kokoro = L.PROVIDERS["kokoro"]
    assert kokoro.support("en-GB") is L.Support.advertised
    assert kokoro.support("ml-IN") is L.Support.unsupported


def test_coverage_reports_the_best_evidence_without_stand_ins():
    rows = {r["code"]: r for r in L.coverage()}
    assert rows["hi-IN"]["llm"] == "advertised" and rows["hi-IN"]["tts"] == "advertised"
    assert rows["ml-IN"]["tts"] == "unverified"  # no cited vendor statement for Malayalam speech
    assert {c for c, r in rows.items() if r["development_target"]} == set(L.DEVELOPMENT_TARGETS)


# ---- routing -----------------------------------------------------------------------------------


def test_routes_each_kind_by_evidence_and_streaming():
    r = select_route("hi-IN", policy())
    assert (r.language, r.language_fallback) == ("hi-IN", False)
    assert (r.stt, r.llm, r.tts) == ("browser-stt", "anthropic", "elevenlabs")
    assert dict(r.evidence) == {"stt": "advertised", "llm": "advertised", "tts": "advertised"}


def test_candidates_are_never_routed_and_unconfigured_providers_are_skipped():
    for code in ("en-GB", "hi-IN", "ar-SA"):
        r = select_route(code, policy())
        assert not {r.stt, r.llm, r.tts} & {"deepgram", "google-stt"}
    with pytest.raises(NoCompliantRoute) as e:  # no language-model key configured
        select_route("en-GB", policy(), available=frozenset({"browser-stt", "kokoro", "elevenlabs"}))
    assert "not configured" in e.value.gaps["llm"]


def test_unverified_language_falls_back_and_says_why():
    r = select_route("ml-IN", policy())  # Malayalam speech output is unverified
    assert r.language == "en-GB" and r.language_fallback
    assert "ml-IN unavailable" in r.reasons[0] and "tts" in r.reasons[0]


def test_unverified_routes_only_when_the_workspace_allows_them():
    r = select_route("ml-IN", policy(allow_unverified=True))
    assert r.language == "ml-IN" and dict(r.evidence)["tts"] == "unverified"


def test_data_residency_is_never_relaxed_by_a_fallback():
    uk_only = policy(allowed_regions=frozenset({"device", "uk"}))
    with pytest.raises(NoCompliantRoute) as e:
        select_route("hi-IN", uk_only)
    assert "us" in e.value.gaps["llm"] and "not allowed" in e.value.gaps["llm"]
    # Even the fallback language cannot reach a US-processing model.
    for kind in L.Kind:
        for p in L.PROVIDERS.values():
            if p.kind is kind and eligible(p, uk_only) is None:
                assert p.regions <= {"device", "uk"}


def test_free_only_workspaces_never_route_to_paid_providers():
    free = frozenset({"browser-stt", "standin-llm", "kokoro"})  # the only free model is the test stand-in
    r = select_route("en-GB", policy(allow_paid=False, allow_unverified=True), available=free | {"anthropic"})
    for pid in (r.stt, r.llm, r.tts):
        assert not L.PROVIDERS[pid].paid


def test_blocked_and_preferred_providers():
    assert select_route("en-GB", policy(blocked_providers=frozenset({"elevenlabs"}))).tts != "elevenlabs"
    assert select_route("en-GB", policy(prefer=("kokoro",))).tts in {"elevenlabs", "kokoro"}


def test_language_outside_the_workspace_uses_the_fallback():
    r = select_route("ar-EG", policy())
    assert r.language == "en-GB" and r.language_fallback


def test_no_fallback_and_no_route_raises_with_reasons():
    p = policy(languages=("ml-IN",), default_language="ml-IN", fallback_language=None)
    with pytest.raises(NoCompliantRoute) as e:
        select_route("ml-IN", p)
    assert "tts" in e.value.gaps


def test_policy_rejects_inconsistent_settings():
    with pytest.raises(ValueError):
        VoicePolicy(default_language="hi-IN", languages=("en-GB",))
    with pytest.raises(ValueError):
        VoicePolicy(languages=("en-GB", "xx-YY"))


def test_routing_is_deterministic():
    assert len({select_route("ar-SA", policy()) for _ in range(20)}) == 1


# ---- language state ----------------------------------------------------------------------------


def test_one_confident_guess_is_not_enough_to_switch():
    s = LanguageState(policy())
    assert not s.observe("hi", 0.95)
    assert s.current == "en-GB"
    assert s.observe("hi-IN", 0.92) and s.current == "hi-IN"
    assert s.history == [("detected", "hi-IN")]


def test_low_confidence_or_unsupported_languages_never_switch_and_reset_the_count():
    s = LanguageState(policy())
    s.observe("hi", 0.95)
    s.observe("hi", 0.40)  # low confidence breaks the run
    assert not s.observe("hi", 0.95) and s.current == "en-GB"
    assert not s.observe("fr", 0.99) and not s.observe("fr", 0.99)
    assert s.current == "en-GB"


def test_a_manual_choice_wins_over_detection():
    s = LanguageState(policy())
    assert s.choose("ar-SA") and s.current == "ar-SA"
    s.observe("hi", 0.99)
    s.observe("hi", 0.99)
    assert s.current == "ar-SA"
    assert not s.choose("fr-FR")


def test_switching_back_needs_confirmation_too():
    s = LanguageState(policy())
    for _ in range(2):
        s.observe("hi", 0.9)
    assert s.current == "hi-IN"
    assert not s.observe("en", 0.9) and s.observe("en", 0.9) and s.current == "en-GB"


def test_language_instruction_only_for_other_languages():
    assert language_instruction("en-GB") is None
    line = language_instruction("hi-IN")
    assert "Hindi" in line and "हिन्दी" in line and "English" in line


# ---- API --------------------------------------------------------------------------------------


def test_languages_endpoint_reports_evidence_and_configuration(make_account):
    a = make_account("ada@example.com")
    r = a.get(a.o("/voice/languages"))
    assert r.status_code == 200
    body = r.json()
    codes = {row["code"] for row in body["languages"]}
    assert {"en-GB", "hi-IN", "ml-IN", "ar-SA"} <= codes
    by_id = {p["id"]: p for p in body["providers"]}
    assert "standin-stt" not in by_id and by_id["deepgram"]["integrated"] is False
    assert by_id["kokoro"]["configured"] and not by_id["anthropic"]["configured"]  # no key in tests


def test_route_preview_respects_configuration_and_policy(make_account):
    a = make_account("ada@example.com")
    # No language-model key is configured in tests, so nothing is routable, with the reason.
    r = a.post(a.o("/voice/route"), json={"language": "en-GB", "allow_paid": True}).json()
    assert r["routable"] is False and "not configured" in r["gaps"]["llm"]
    assert a.post(a.o("/voice/route"), json={"language": "xx-YY"}).status_code == 422
    bad = {"language": "hi-IN", "default_language": "hi-IN", "languages": ["en-GB"]}
    assert a.post(a.o("/voice/route"), json=bad).status_code == 422


def test_route_preview_with_a_configured_model(make_account, monkeypatch):
    from app.routers import languages as api

    monkeypatch.setattr(api, "configured_providers", lambda: frozenset({"browser-stt", "anthropic", "kokoro"}))
    a = make_account("ada@example.com")
    body = {"language": "hi-IN", "languages": ["en-GB", "hi-IN"], "allow_paid": True}
    r = a.post(a.o("/voice/route"), json=body).json()
    # Hindi speech output is not available from Kokoro, so the call falls back to English, and says so.
    assert r["routable"] and r["language"] == "en-GB" and r["language_fallback"]
    assert r["tts"] == "kokoro" and r["llm"] == "anthropic"


def test_another_workspace_member_check_applies(make_account):
    a, b = make_account("a@example.com"), make_account("b@example.com")
    assert b.get(a.o("/voice/languages")).status_code in (403, 404)


def test_brain_replies_in_the_callers_language_without_breaking_the_cache(make_account, live):  # noqa: F811
    import json as _json

    from .test_live import message, setup_business

    a = make_account("ada@example.com")
    setup_business(a)
    reply = message([("text", {"parts": ["नमस्ते"]})], "end_turn", 50, 4)
    live["llm"] = [(200, reply), (200, reply)]
    for lang in (None, "hi-IN"):
        body = {"request_id": f"lang-{lang or 'none'}-01", "messages": [{"role": "user", "text": "Namaste"}]}
        if lang:
            body["language"] = lang
        assert a.post(a.o("/live/brain"), json=body).status_code == 200
    plain, hindi = (_json.loads(r.content)["system"] for r in live["llm_requests"])
    assert plain[0] == hindi[0] and "cache_control" in hindi[0]  # cached prefix unchanged
    assert "Hindi" not in plain[-1]["text"] and "Reply in Hindi" in hindi[-1]["text"]
    bad = {"request_id": "lang-bad-0001", "language": "xx-YY", "messages": [{"role": "user", "text": "Hi"}]}
    assert a.post(a.o("/live/brain"), json=bad).status_code == 422


def test_stand_ins_are_invisible_unless_configured():
    with pytest.raises(NoCompliantRoute) as e:
        select_route("en-GB", policy(), available=frozenset({"browser-stt", "kokoro"}))
    assert "standin" not in str(e.value.gaps)
    r = select_route(
        "en-GB",
        policy(allow_unverified=True),
        available=frozenset({"standin-stt", "standin-llm", "standin-tts"}),
    )
    assert (r.stt, r.llm, r.tts) == ("standin-stt", "standin-llm", "standin-tts")
