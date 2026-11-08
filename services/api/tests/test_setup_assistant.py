"""The setup assistant: its tools (same validation as the REST API) and the streamed endpoint."""

import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from pydantic import SecretStr

from app.config import get_settings
from app.db import SessionLocal, set_tenant
from app.live import setup_agent

from .conftest import join
from .test_live import events, live, message  # noqa: F401  (live is a fixture)


@pytest.fixture
def tool(make_account):
    """Runs setup tools as the owner of a fresh workspace, through a tenant-scoped session."""
    a = make_account("ada@example.com", "EW Saloon")
    db = SessionLocal()
    set_tenant(db, org_id=uuid.UUID(a.org_id), user_id=uuid.UUID(a.user_id))
    ctx = setup_agent.SetupContext(uuid.UUID(a.org_id), uuid.UUID(a.user_id))

    def call(tool_name, /, **args):
        ok, out = setup_agent.run_tool(db, ctx, tool_name, args)
        return ok, json.loads(out)

    call.account = a
    yield call
    db.close()


def test_state_lists_what_is_missing(tool):
    ok, s = tool("get_setup_state")
    assert ok and s["business"]["display_name"] == "EW Saloon"
    assert s["missing"] == ["phone", "address", "opening_hours", "services", "receptionist"]


def test_business_details_merge_and_validate(tool):
    a = tool.account
    nulls = {
        k: None
        for k in (
            "display_name",
            "business_type",
            "phone",
            "email",
            "website",
            "address_line1",
            "city",
            "postcode",
            "description",
        )
    }
    ok, out = tool(
        "update_business_details",
        **{
            **nulls,
            "business_type": "hair_beauty",
            "phone": "0117 496 0123",
            "city": "Bristol",
            "website": "ewsaloon.example",
        },
    )
    assert ok and out["saved"] == ["city", "phone", "sector", "website"]
    p = a.get(a.o("/business-profile")).json()
    assert (p["display_name"], p["phone"], p["city"], p["website"]) == (
        "EW Saloon",
        "0117 496 0123",
        "Bristol",
        "https://ewsaloon.example",
    )
    ok, out = tool("update_business_details", **{**nulls, "phone": "call me maybe"})
    assert not ok and "phone" in out["error"]
    assert a.get(a.o("/business-profile")).json()["phone"] == "0117 496 0123"  # unchanged
    assert any(l["details"].get("via") == "setup_assistant" for l in a.get(a.o("/audit-logs")).json())


def test_hours_services_capacity_and_receptionist(tool):
    a = tool.account
    ok, out = tool("set_opening_hours", days=[{"weekday": d, "opens": "09:00", "closes": "17:30"} for d in range(1, 6)])
    assert ok and out["saved_days"] == ["Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    assert not tool("set_opening_hours", days=[{"weekday": 0, "opens": "18:00", "closes": "09:00"}])[0]
    assert len(a.get(a.o("/office-hours")).json()["intervals"]) == 5  # bad input changed nothing

    svc = [
        {"name": "Women's cut", "duration_minutes": 60, "price_from_gbp": 45, "requires_patch_test": False},
        {"name": "Colour", "duration_minutes": 90, "price_from_gbp": 75.5, "requires_patch_test": True},
    ]
    assert tool("add_services", services=svc)[1] == {
        "added": ["Women's cut", "Colour"],
        "restored": [],
        "already_existed": [],
    }
    assert tool("add_services", services=svc[:1])[1] == {
        "added": [],
        "restored": [],
        "already_existed": ["Women's cut"],
    }
    prices = {s["name"]: s["price_from_pence"] for s in a.get(a.o("/services")).json()}
    assert prices == {"Colour": 7550, "Women's cut": 4500}

    assert not tool("set_booking_capacity", capacity=0)[0]
    assert tool("set_booking_capacity", capacity=3)[0]
    assert a.get(a.o("/settings")).json()["booking_capacity"] == 3

    ok, out = tool("create_receptionist", name="Ava", greeting="Hello, you're through to EW Saloon, how can I help?")
    assert not ok and "greeting" in out["error"]  # must disclose it's an AI
    assert tool("create_receptionist", name="Ava", greeting="Hello, I'm Ava, the AI receptionist at EW Saloon.")[0]
    assert tool("get_setup_state")[1]["missing"] == ["phone", "address"]


def test_status_and_permissions(make_account, monkeypatch):
    owner = make_account("ada@example.com", "EW Saloon")
    mgr = make_account("mo@example.com", "M")
    join(owner, mgr, "manager")
    mgr.org_id = owner.org_id
    assert owner.get(owner.o("/live/setup-assistant/status")).json() == {"ai": False}
    body = {"request_id": "setup-0001-abcd", "messages": [{"role": "user", "text": "hi"}]}
    assert (
        owner.post(owner.o("/live/setup-assistant"), json=body).status_code == 503
    )  # no key: the app uses guided mode
    assert mgr.post(mgr.o("/live/setup-assistant"), json=body).status_code == 403


def test_streams_a_setup_turn_with_tools(make_account, live):  # noqa: F811
    a = make_account("ada@example.com", "EW Saloon")
    assert a.get(a.o("/live/setup-assistant/status")).json() == {"ai": True}
    live["llm"] = [
        (200, message([("tool", {"id": "toolu_s", "name": "get_setup_state"})], "tool_use", 900, 20)),
        (
            200,
            message(
                [("text", {"parts": ["Let's start. ", "What kind of business is EW Saloon?"]})], "end_turn", 1100, 15
            ),
        ),
    ]
    r = a.post(
        a.o("/live/setup-assistant"),
        json={"request_id": "setup-0001-abcd", "messages": [{"role": "user", "text": "Help me set up"}]},
    )
    ev = events(r)
    assert [e["type"] for e in ev] == ["tool", "text", "text", "done"]
    assert ev[0]["name"] == "get_setup_state" and ev[0]["ok"] and "EW Saloon" in ev[0]["result"]
    first = json.loads(live["llm_requests"][0].content)
    system = " ".join(b["text"] for b in first["system"])
    assert "setup assistant" in system and "EW Saloon" in system
    assert first["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert {t["name"] for t in first["tools"]} == {t["name"] for t in setup_agent.TOOLS}
    assert get_settings().anthropic_api_key == SecretStr("sk-test")


def test_template_update_and_remove_services(tool):
    a = tool.account
    ok, out = tool("get_business_template", business_type="hair_beauty")
    assert ok and out == {"template": None}
    ok, out = tool("get_business_template", business_type="barbershop")
    t = out["template"]
    assert t["label"] == "Barbershop" and len(t["services"]) == 29
    assert {"weekday": 3, "opens": "09:00", "closes": "20:00"} in t["opening_hours"]
    assert "24 hours' notice" in t["policies_description"]
    assert a.get(a.o("/services")).json() == []  # reading a template saves nothing

    svc = [{**s, "requires_patch_test": False} for s in t["services"][:3]]
    assert tool("add_services", services=svc)[1]["added"] == ["Classic men's cut", "Skin fade", "Low, mid or high fade"]
    saved = {s["name"]: s for s in a.get(a.o("/services")).json()}
    assert (saved["Skin fade"]["category"], saved["Skin fade"]["buffer_min"]) == ("Haircuts", 5)

    # Corrections change one service; a part-name works only when it is unambiguous.
    ok, out = tool(
        "update_service", name="skin", new_name=None, duration_minutes=None, price_from_gbp=25, category=None
    )
    assert ok and out == {
        "updated": "Skin fade",
        "fields": ["price_from_pence"],
        "before": {"price_from_pence": 2400},
        "after": {"price_from_pence": 2500},
    }
    ok, out = tool(
        "update_service", name="fade", new_name=None, duration_minutes=40, price_from_gbp=None, category=None
    )
    assert not ok and "could be Low, mid or high fade, Skin fade" in out["error"]
    ok, out = tool(
        "update_service",
        name="Skin fade",
        new_name="Classic men's cut",
        duration_minutes=None,
        price_from_gbp=None,
        category=None,
    )
    assert not ok and "already exists" in out["error"]
    assert not tool(
        "update_service", name="Skin fade", new_name=None, duration_minutes=None, price_from_gbp=None, category=None
    )[0]

    ok, out = tool("remove_services", names=["Low, mid or high fade", "Perm"])
    assert ok and out["removed"] == ["Low, mid or high fade"] and "no service called" in out["problems"][0]
    prices = {s["name"]: s["price_from_pence"] for s in a.get(a.o("/services")).json()}
    assert prices == {"Classic men's cut": 2000, "Skin fade": 2500}

    # Split days (a lunch break) are two intervals on the same weekday.
    days = [{"weekday": 0, "opens": "09:00", "closes": "13:00"}, {"weekday": 0, "opens": "14:00", "closes": "17:00"}]
    assert tool("set_opening_hours", days=days)[0]
    assert len(a.get(a.o("/office-hours")).json()["intervals"]) == 2


def test_barbershop_is_a_business_type():
    assert "barbershop" in setup_agent.SECTORS
    assert "barbershop" in json.dumps(setup_agent.TOOLS)
    assert setup_agent.template("../secrets") is None


def test_update_receptionist(tool):
    a = tool.account
    ok, out = tool("update_receptionist", name="Sam", greeting=None)
    assert not ok and "create_receptionist" in out["error"]
    assert tool("create_receptionist", name="Ava", greeting="Hello, I'm Ava, the AI receptionist at EW Saloon.")[0]
    ok, out = tool("update_receptionist", name="Sam", greeting="Hello, I'm Sam, the AI receptionist at EW Saloon.")
    assert ok and out["before"] == {"name": "Ava", "greeting": "Hello, I'm Ava, the AI receptionist at EW Saloon."}
    ok, out = tool("update_receptionist", name=None, greeting="Hello, thanks for calling EW Saloon!")
    assert not ok and "greeting" in out["error"]  # must still disclose it's an AI
    assert [x["name"] for x in a.get(a.o("/agents")).json()] == ["Sam"]
    assert not tool("update_receptionist", name=None, greeting=None)[0]


def test_remove_then_undo_restores_the_same_service_and_its_bookings(tool):
    a = tool.account
    week = {"intervals": [{"weekday": d, "opens_at": "00:00", "closes_at": "23:59"} for d in range(7)]}
    a.put(a.o("/office-hours"), json=week)
    svc = a.post(a.o("/services"), json={"name": "Skin fade", "duration_min": 30, "price_from_pence": 2400}).json()
    day = (datetime.now(UTC) + timedelta(days=2)).date().isoformat()
    slot = a.get(a.o(f"/availability?service_id={svc['id']}&on={day}")).json()["slots"][0]
    appt = a.post(
        a.o("/appointments"),
        json={"service_id": svc["id"], "starts_at": slot, "customer_name": "Ann", "customer_phone": "07700900111"},
    ).json()

    # A part of the name is not enough to delete anything.
    ok, out = tool("remove_services", names=["fade"])
    assert ok and out["removed"] == [] and "Did you mean Skin fade" in out["problems"][0]

    ok, out = tool("remove_services", names=["Skin fade"])
    assert ok and out["removed"] == ["Skin fade"]
    assert a.get(a.o("/services")).json() == []  # callers can't book it any more…
    assert a.get(a.o("/appointments")).json()[0]["service_id"] == svc["id"]  # …but the booking keeps it

    # Undo: the very same service comes back, with the same id.
    undo = [{"name": "Skin fade", "duration_minutes": 30, "price_from_gbp": 24, "requires_patch_test": False}]
    ok, out = tool("add_services", services=[{**x, "category": None, "buffer_minutes": None} for x in undo])
    assert ok and out == {"added": [], "restored": ["Skin fade"], "already_existed": []}
    [back] = a.get(a.o("/services")).json()
    assert back["id"] == svc["id"] and back["price_from_pence"] == 2400
    assert a.get(a.o("/appointments")).json()[0]["id"] == appt["id"]


def test_changes_report_before_and_after_so_undo_is_exact(tool):
    a = tool.account
    a.put(a.o("/business-profile"), json={"display_name": "EW Saloon", "city": "Leeds", "phone": "0113 496 0000"})
    fields = dict.fromkeys(
        ["display_name", "business_type", "email", "website", "address_line1", "postcode", "description"]
    )
    ok, out = tool("update_business_details", **fields, phone="0113 496 0999", city=None)
    assert ok and out["before"] == {"phone": "0113 496 0000"} and out["after"] == {"phone": "0113 496 0999"}
    assert tool("update_business_details", **fields, phone=out["before"]["phone"], city=None)[0]
    assert a.get(a.o("/business-profile")).json()["phone"] == "0113 496 0000"

    old = [{"weekday": 0, "opens": "09:00", "closes": "17:00"}, {"weekday": 5, "opens": "10:00", "closes": "16:00"}]
    assert tool("set_opening_hours", days=old)[0]
    ok, out = tool("set_opening_hours", days=[{"weekday": 0, "opens": "08:00", "closes": "20:00"}])
    assert ok and out["previous_hours"] == old
    assert tool("set_opening_hours", days=out["previous_hours"])[0]  # undo
    got = a.get(a.o("/office-hours")).json()["intervals"]
    assert [(i["weekday"], i["opens_at"][:5], i["closes_at"][:5]) for i in got] == [
        (0, "09:00", "17:00"),
        (5, "10:00", "16:00"),
    ]


def test_absurd_values_are_refused_without_a_crash(tool):
    svc = {
        "name": "Cut",
        "duration_minutes": 30,
        "requires_patch_test": False,
        "category": None,
        "buffer_minutes": None,
    }
    ok, out = tool("add_services", services=[{**svc, "price_from_gbp": 1e308}])
    assert not ok and "error" in out
    ok, out = tool("set_booking_capacity", capacity=10_000)
    assert not ok
    assert tool.account.get(tool.account.o("/services")).json() == []
