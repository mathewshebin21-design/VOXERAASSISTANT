"""Agent Testing Lab: the standard scenarios, custom tests, and the publish gate."""

import pytest

from .test_flow_engine import WEEK, shop  # noqa: F401  (shop is a fixture)


def run(acct, **body) -> dict:
    r = acct.post(acct.flow("/tests/run"), json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_the_twelve_standard_scenarios_pass_on_the_default_flow(shop):  # noqa: F811
    tests = shop.get(shop.flow("/tests")).json()
    assert len(tests) == 12
    report = run(shop)
    failed = {
        r["name"]: [a for a in r["assertions"] if a["status"] == "failed"] or r["error"]
        for r in report["results"]
        if not r["passed"]
    }
    assert report["summary"] == {"total": 12, "passed": 12, "failed": 0, "model_graded_skipped": 0}, failed
    booking = next(r for r in report["results"] if r["name"] == "Book an appointment")
    assert booking["outcome"] == "booked" and booking["tokens"] == 0 and booking["estimated_cost_gbp"] == 0
    assert "voice" in booking["kind"] and "not tested" in booking["kind"]
    assert any(t["name"] == "book_appointment" and t["ok"] for t in booking["tool_calls"])
    assert report["filled"]["service"] == "Beard trim"  # first active service, alphabetically


def test_test_runs_never_write(shop, owner_engine):  # noqa: F811
    from sqlalchemy import text

    run(shop)
    with owner_engine.connect() as c:
        assert c.execute(text("SELECT count(*) FROM appointments")).scalar() == 0
        assert c.execute(text("SELECT count(*) FROM caller_messages")).scalar() == 0


def test_custom_tests_and_failures_are_reported_with_evidence(shop):  # noqa: F811
    sc = {
        "name": "Opening hours",
        "lines": ["what time do you open?"],
        "assertions": [
            {"type": "says", "value": "We're open"},
            {"type": "says", "value": "free parking"},
            {"type": "judge", "value": "Sounds friendly"},
        ],
    }
    t = shop.post(shop.flow("/tests"), json={"scenario": sc}).json()
    r = run(shop, test_ids=[t["id"]])["results"][0]
    statuses = [a["status"] for a in r["assertions"]]
    assert statuses == ["passed", "failed", "skipped"] and r["passed"] is False
    assert r["assertions"][2]["graded_by"] == "model" and "AI provider" in r["assertions"][2]["actual"]
    assert any(e["source"] == "office_hours" for e in r["evidence"])

    sc["assertions"] = sc["assertions"][:1]
    assert shop.put(shop.flow(f"/tests/{t['id']}"), json={"scenario": sc}).status_code == 200
    assert run(shop, test_ids=[t["id"]])["results"][0]["passed"] is True
    assert shop.delete(shop.flow(f"/tests/{t['id']}")).status_code == 204
    assert len(shop.get(shop.flow("/tests")).json()) == 12


def test_publishing_is_blocked_until_tests_pass(shop):  # noqa: F811
    bad = {"name": "Always fails", "lines": ["hello"], "assertions": [{"type": "says", "value": "zebra"}]}
    t = shop.post(shop.flow("/tests"), json={"scenario": bad}).json()
    r = shop.post(shop.flow("/publish"), json={"base_revision": 1})
    assert r.status_code == 422 and r.json()["detail"]["tests"]["summary"]["failed"] == 1
    assert shop.get(shop.flow()).json()["published_version"] is None
    shop.delete(shop.flow(f"/tests/{t['id']}"))
    r = shop.post(shop.flow("/publish"), json={"base_revision": 1})
    assert r.status_code == 200
    assert r.json()["versions"][0]["tests"] == {"total": 12, "passed": 12, "failed": 0, "model_graded_skipped": 0}


def test_invalid_scenarios_are_rejected(shop):  # noqa: F811
    for bad in (
        {"name": "x", "lines": [], "assertions": [{"type": "says", "value": "a"}]},
        {"name": "x", "lines": ["hi"], "assertions": [{"type": "hack", "value": "a"}]},
        {"name": "x", "lines": ["hi"], "assertions": [{"type": "says"}], "extra": 1},
    ):
        assert shop.post(shop.flow("/tests"), json={"scenario": bad}).status_code == 422


@pytest.mark.parametrize("role", ["viewer"])
def test_viewers_can_run_but_not_edit_tests(shop, make_account, role):  # noqa: F811
    from .conftest import join

    m = make_account(f"{role}@example.com", "Mine")
    join(shop, m, role)
    m.org_id = shop.org_id
    url = m.o(f"/agents/{shop.agent_id}/flow")
    assert m.get(f"{url}/tests").status_code == 200
    assert m.post(f"{url}/tests/run", json={}).status_code == 200
    sc = {"name": "x", "lines": ["hi"], "assertions": [{"type": "says", "value": "a"}]}
    assert m.post(f"{url}/tests", json={"scenario": sc}).status_code == 403
