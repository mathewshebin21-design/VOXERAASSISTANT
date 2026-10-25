from sqlalchemy import text

from .conftest import join

TURNS = [
    {
        "turn": 0,
        "input": "greeting",
        "sttMs": None,
        "brainFirstMs": 1,
        "brainTotalMs": 2,
        "ttsFirstMs": 180,
        "e2eMs": 190,
        "interrupted": False,
        "bargeInRecoveryMs": None,
        "failures": [],
        "fallbacks": [],
    },
    {
        "turn": 1,
        "input": "voice",
        "sttMs": 420,
        "brainFirstMs": 2,
        "brainTotalMs": 3,
        "ttsFirstMs": 210,
        "e2eMs": 640,
        "interrupted": True,
        "bargeInRecoveryMs": 35,
        "failures": [],
        "fallbacks": [],
    },
    {
        "turn": 2,
        "input": "typed",
        "sttMs": None,
        "brainFirstMs": None,
        "brainTotalMs": None,
        "ttsFirstMs": 200,
        "e2eMs": 6200,
        "interrupted": False,
        "bargeInRecoveryMs": None,
        "failures": ["brain"],
        "fallbacks": ["brain→Message-taker fallback (local)"],
    },
]
BODY = {
    "client_session_id": "lab-0001-abcdef",
    "started_at": "2026-10-25T21:00:00+00:00",
    "duration_ms": 61000,
    "stt_provider": "Browser speech recognition (Web Speech API)",
    "brain_provider": "Rule-based receptionist (local)",
    "tts_provider": "Browser speech synthesis",
    "turns": TURNS,
}


def test_save_is_idempotent_and_summary_is_server_computed(make_account, owner_engine):
    a = make_account("ada@example.com")
    first = a.post(a.o("/voice-sessions"), json=BODY)
    assert first.status_code == 201, first.text
    s = first.json()["summary"]
    assert s["time_to_first_audio_ms"] == 190
    assert s["e2e_ms"] == {"n": 2, "p50": 640, "p95": 6200}
    assert s["barge_ins"] == 1 and s["fallbacks"] == 1
    assert s["failure_rate"]["brain"] == round(1 / 3, 4)
    again = a.post(a.o("/voice-sessions"), json=BODY)
    assert again.status_code == 200 and again.json()["id"] == first.json()["id"]
    detail = a.get(a.o(f"/voice-sessions/{first.json()['id']}")).json()
    assert detail["turns"][1]["sttMs"] == 420
    assert [l["action"] for l in a.get(a.o("/audit-logs")).json()][0] == "voice_session.saved"
    with owner_engine.connect() as c:
        assert c.execute(text("SELECT count(*) FROM voice_test_sessions")).scalar() == 1


def test_validation_rejects_bad_metrics(make_account):
    a = make_account("ada@example.com")
    bad_turn = {**TURNS[0], "e2eMs": -5}
    assert a.post(a.o("/voice-sessions"), json={**BODY, "turns": [bad_turn]}).status_code == 422
    assert a.post(a.o("/voice-sessions"), json={**BODY, "turns": [{**TURNS[0], "transcript": "hi"}]}).status_code == 422
    assert a.post(a.o("/voice-sessions"), json={**BODY, "turns": []}).status_code == 422
    assert a.post(a.o("/voice-sessions"), json={**BODY, "started_at": "2026-10-25T21:00:00"}).status_code == 422


def test_roles_and_tenant_isolation(make_account):
    owner = make_account("ada@example.com")
    viewer = make_account("vic@example.com", "Vic Org")
    join(owner, viewer, "viewer")
    viewer.org_id = owner.org_id
    sid = owner.post(owner.o("/voice-sessions"), json=BODY).json()["id"]
    assert (
        viewer.post(viewer.o("/voice-sessions"), json={**BODY, "client_session_id": "lab-0002-xyz"}).status_code == 403
    )
    assert len(viewer.get(viewer.o("/voice-sessions")).json()) == 1
    other = make_account("olu@example.com", "Elsewhere")
    assert other.get(f"/v1/orgs/{owner.org_id}/voice-sessions").status_code == 404
    assert other.get(other.o(f"/voice-sessions/{sid}")).status_code == 404
    assert other.get(other.o("/voice-sessions")).json() == []


def test_rls_hides_rows_without_tenant_context(make_account, app_engine):
    a = make_account("ada@example.com")
    a.post(a.o("/voice-sessions"), json=BODY)
    with app_engine.connect() as c:
        assert c.execute(text("SELECT count(*) FROM voice_test_sessions")).scalar() == 0


def test_export_includes_voice_sessions(make_account):
    a = make_account("ada@example.com")
    a.post(a.o("/voice-sessions"), json=BODY)
    assert len(a.get(a.o("/export")).json()["voice_test_sessions"]) == 1
