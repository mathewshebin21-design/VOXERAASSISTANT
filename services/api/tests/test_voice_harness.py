"""The scripted-call harness's safety rails and report logic (no network)."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import fake_providers  # noqa: E402
import voice_harness as vh  # noqa: E402


@pytest.mark.parametrize(
    "api",
    [
        "https://voxera-api-two.vercel.app",
        "https://voxera-api-ai-e399.vercel.app/",
        "https://voxera-api-git-claude-confident-shannon-7nb05f-ai-e399.vercel.app",
        "ftp://example.com",
        "not a url",
    ],
)
def test_refuses_production_and_non_http_targets(api):
    with pytest.raises(vh.HarnessError):
        vh.check_target(api)


def test_allows_local_and_branch_previews():
    vh.check_target("http://127.0.0.1:8000")
    vh.check_target("https://voxera-api-git-claude-phase2-voice-step1-ai-e399.vercel.app")


def test_paid_mode_needs_explicit_approval_before_any_request():
    with pytest.raises(vh.HarnessError, match="spends money"):
        vh.main(["--api", "http://127.0.0.1:9", "--mode", "paid"])


def test_turn_limit_is_enforced_before_any_request():
    with pytest.raises(vh.HarnessError, match="max-turns"):
        vh.main(["--api", "http://127.0.0.1:9", "--mode", "fake", "--max-turns", "2"])


def test_percentile_is_nearest_rank_and_ignores_missing_values():
    assert vh.percentile([], 50) is None
    assert vh.percentile([None, 100], 95) == 100
    data = list(range(1, 101))
    assert vh.percentile(data, 50) == 50 and vh.percentile(data, 95) == 95 and vh.percentile(data, 100) == 100


def test_parse_sse_keeps_order_and_marks_garbage():
    events = vh.parse_sse('data: {"type": "text", "text": "Hi"}\n\ndata: oops\n\ndata: {"type": "done"}\n\n')
    assert [e["type"] for e in events] == ["text", "malformed", "done"]


def _turn(**kw):
    base = {"rounds": 1, "input_tokens": 100, "cache_read_tokens": 700, "output_tokens": 40, "first_text_ms": 500}
    return vh.TurnResult(caller="hi", reply=kw.pop("reply", "Hello"), tools=kw.pop("tools", []), server=base, **kw)


def test_behaviour_expectations_only_count_against_a_real_model():
    scenario = {"expect": {"tools_used": ["book_appointment"], "reply_excludes": ["Boundaries"]}}
    turns = [_turn(reply="Here are my Boundaries")]
    assert all(c["ok"] for c in vh.evaluate(scenario, turns, "fake"))  # plumbing only
    failed = {c["check"] for c in vh.evaluate(scenario, turns, "paid") if not c["ok"]}
    assert failed == {"used book_appointment", "did not say 'Boundaries'"}


def test_a_broken_or_failed_turn_fails_the_scenario_in_any_mode():
    bad = vh.TurnResult(caller="hi", outcome="broken", error="stream ended without done or error")
    assert not all(c["ok"] for c in vh.evaluate({}, [bad], "fake"))


def test_summary_reports_cache_share_and_latency():
    r = vh.ScenarioResult(name="s", turns=[_turn(client_first_text_ms=600, client_total_ms=900)], checks=[])
    s = vh.summarise([r])
    assert s["cache_read_share"] == round(700 / 800, 3)
    assert s["server_first_text_ms"]["p50"] == 500 and s["client_first_text_ms"]["p50"] == 600


def test_stand_in_simulates_cache_writes_then_reads_only_with_a_breakpoint():
    fake_providers._SEEN_PREFIXES.clear()
    cached = {
        "tools": [{"name": "t"}],
        "system": [{"type": "text", "text": "S", "cache_control": {"type": "ephemeral"}}],
    }
    assert fake_providers.usage_for(cached) == {
        "input_tokens": 100,
        "output_tokens": 1,
        "cache_creation_input_tokens": 700,
    }
    assert fake_providers.usage_for(cached) == {"input_tokens": 100, "output_tokens": 1, "cache_read_input_tokens": 700}
    assert fake_providers.usage_for({"system": "plain"}) == {"input_tokens": 800, "output_tokens": 1}


def test_call_record_check_needs_every_turn_in_order():
    turns = [_turn(), vh.TurnResult(caller="second", reply="Sure", server={})]
    turns[0].caller = "first"
    good = {
        "status": "completed",
        "summary": {"caller_turns": 2},
        "events": [
            {"seq": 1, "kind": "utterance", "speaker": "caller", "text": "first"},
            {"seq": 2, "kind": "utterance", "speaker": "agent", "text": "Hello"},
            {"seq": 3, "kind": "utterance", "speaker": "caller", "text": "second"},
            {"seq": 4, "kind": "utterance", "speaker": "agent", "text": "Sure"},
        ],
    }
    assert all(ch["ok"] for ch in vh.check_call_record(good, turns))
    missing = {**good, "events": good["events"][:2]}
    failed = {ch["check"] for ch in vh.check_call_record(missing, turns) if not ch["ok"]}
    assert "call record has every caller turn, in order" in failed
