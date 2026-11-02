"""The setup assistant: a Claude agent that sets a workspace up by conversation.

It can only change setup data (business details, hours, services, capacity, the receptionist)
and every write goes through the same validation schemas as the REST API, is audited against
the signed-in owner/admin, and is scoped to their workspace by RLS.
"""

import json
import uuid
from dataclasses import dataclass
from functools import cache
from pathlib import Path

from pydantic import ValidationError
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .. import audit
from ..models import Agent, BusinessProfile, OfficeHours, Service, WorkspaceSettings
from ..schemas import AgentIn, AgentPatch, BusinessProfileIO, HoursIn, ServiceIn, ServicePatch

SECTORS = [
    "hair_beauty",
    "barbershop",
    "aesthetics",
    "wellness",
    "clinic",
    "trades",
    "hospitality",
    "professional",
    "agency",
    "fitness",
    "other",
]
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
TEMPLATES_DIR = Path(__file__).parent / "templates"


@cache
def template(sector: str) -> dict | None:
    """A ready-made starting point for a type of business (kept in step with the guided assistant's copy)."""
    f = TEMPLATES_DIR / f"{sector}.json"
    return json.loads(f.read_text()) if sector.isidentifier() and f.is_file() else None


def system_prompt(business_name: str) -> str:
    # The noqa on the closing line: S608 mistakes this English ("update … set") for SQL.
    return f"""You are the VOXERA setup assistant, helping the owner of {business_name} get their AI phone \
receptionist ready. You are friendly, calm and brief: plain sentences, no jargon, one question at a time.

Start by calling get_setup_state to see what's already done, then work through what's missing, roughly in this \
order: type of business, phone, address, opening hours, services (name, how long, starting price), how many \
customers can be seen at once, and the receptionist's name and greeting.

When the owner tells you something, read back your interpretation in one short line, then save it with the \
right tool straight away (they can always correct you). Never invent details they haven't given — ask instead. \
If a tool returns an error, explain it simply and ask for what's needed. Prices are in pounds; times are 24-hour.
The receptionist's greeting must say it is an AI receptionist (UK rules on disclosure).

Owners of every kind of business use this, and they write the way they talk. Understand them without confusion:
- Business type: map their words to the closest business_type ("gents barbers", "men's grooming" → barbershop; \
"massage therapist" → wellness; "dog groomer", "tattoo studio" → other). If it's genuinely unclear, ask.
- Hours: "9-5" means 09:00–17:00; "Thu till 8" or "late Thursday" moves only Thursday's closing time; "every day \
except Sunday" leaves Sunday closed; a lunch break ("closed 1-2", "9-12 and 1-5") becomes two periods that day; \
"24/7" is 00:00–23:59. A day they didn't mention is closed — say which days you've treated as closed. \
set_opening_hours replaces the whole week, so when they change one day, resend every other day as it was. \
Bank holidays and seasonal hours can't go in the weekly hours: offer to add a sentence about them to the \
description.
- Services: a price range ("£18–£25") is saved with the lowest as the starting price, and you say so. "Free" is £0; \
"POA" or "price varies" is no price. Several services on one line are separate services. A heading such as \
"Haircuts:" is the category for the lines under it. If no length is given, ask (or, with a template, offer the \
template's typical length) rather than guessing silently.
- Corrections ("actually Saturday is 9-5", "skin fade is £25", "we don't do perms") change only that item: use \
update_service or remove_services, never re-add or wipe the rest. If a name could mean more than one service, list \
them and ask which.
- Capacity is how many customers can be seen at once: with "4 chairs but 2 barbers" it's 2 (the smaller number).
- If they ask a question ("what's capacity?", "why do you need this?"), answer it in a sentence and ask again.

If get_business_template has a template for their business type, offer it when you reach hours or services. Show \
it briefly (grouped by category, with lengths and "from" prices), let them change anything, and only then save it: \
hours with set_opening_hours, services with add_services (keep each service's category and buffer), and the \
template's policies with update_business_details as the description — but only if they have no description yet, \
or they agree to replace it.

Owners can ask for changes at any time, during setup or long after it: "skin fade is now £25", "we're closed on \
Mondays now", "we've hired another barber", "rename the receptionist to Sam", "tell callers we have free parking". \
Just do it: check get_setup_state for the current values, make the change with the right tool straight away \
(don't ask "shall I?"), then say exactly what changed as before → after, e.g. "Skin fade: £24 → £25". If they say \
"undo" or "change it back", put the previous values back the same way. Only ask first when the request could \
mean more than one thing (several services match, or no days were given for "we close at 6"). For "put all prices \
up £2" or "10% on haircuts", call update_service for each service affected and list the new prices. To add \
something callers should be told, append a sentence to the existing description — never replace what's there. \
Renaming the receptionist uses update_receptionist (its greeting keeps saying it's an AI); never create a second one.

When everything is set, say so and suggest the next steps: go Available on the Desk, invite the team on the \
Team page, and try a test call in the Voice lab. Only help with setting up and running this workspace's setup."""  # noqa: S608


def _obj(props: dict) -> dict:
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


def _tool(name: str, description: str, schema: dict) -> dict:
    return {
        "name": name,
        "description": description,
        "input_schema": schema,
        "strict": True,
        "eager_input_streaming": True,
    }


NS = {"type": ["string", "null"]}
TOOLS = [
    _tool("get_setup_state", "What is already set up in this workspace, and what is missing.", _obj({})),
    _tool(
        "update_business_details",
        "Save business details. Pass null for anything not being changed.",
        _obj(
            {
                "display_name": NS,
                "business_type": {"type": ["string", "null"], "enum": [*SECTORS, None]},
                "phone": NS,
                "email": NS,
                "website": NS,
                "address_line1": NS,
                "city": NS,
                "postcode": NS,
                "description": NS,
            }
        ),
    ),
    _tool(
        "set_opening_hours",
        "Replace the whole week. Days not listed are closed. weekday: 0 = Monday … 6 = Sunday; times HH:MM. "
        "A day with a break has two entries (e.g. 09:00–13:00 and 14:00–17:00).",
        _obj(
            {
                "days": {
                    "type": "array",
                    "items": _obj(
                        {"weekday": {"type": "integer"}, "opens": {"type": "string"}, "closes": {"type": "string"}}
                    ),
                }
            }
        ),
    ),
    _tool(
        "add_services",
        "Add bookable services. Services that already exist (same name) are skipped.",
        _obj(
            {
                "services": {
                    "type": "array",
                    "items": _obj(
                        {
                            "name": {"type": "string"},
                            "duration_minutes": {"type": "integer"},
                            "price_from_gbp": {"type": ["number", "null"]},
                            "requires_patch_test": {"type": "boolean"},
                            "category": NS,
                            "buffer_minutes": {"type": ["integer", "null"]},
                        }
                    ),
                }
            }
        ),
    ),
    _tool(
        "update_service",
        "Change one existing service, found by its current name. Pass null for anything not being changed.",
        _obj(
            {
                "name": {"type": "string"},
                "new_name": NS,
                "duration_minutes": {"type": ["integer", "null"]},
                "price_from_gbp": {"type": ["number", "null"]},
                "category": NS,
            }
        ),
    ),
    _tool(
        "remove_services",
        "Delete services the business doesn't offer, by exact name.",
        _obj({"names": {"type": "array", "items": {"type": "string"}}}),
    ),
    _tool(
        "get_business_template",
        "A ready-made template (services with lengths and from-prices, typical hours, booking policies) for a "
        "business type, or null if there isn't one. Reading it saves nothing.",
        _obj({"business_type": {"type": "string", "enum": SECTORS}}),
    ),
    _tool(
        "set_booking_capacity",
        "How many customers can be seen at the same time (1–50).",
        _obj({"capacity": {"type": "integer"}}),
    ),
    _tool(
        "create_receptionist",
        "Create the AI receptionist. The greeting must say it is an AI receptionist.",
        _obj({"name": {"type": "string"}, "greeting": {"type": "string"}}),
    ),
    _tool(
        "update_receptionist",
        "Rename the existing receptionist or change its greeting. Pass null for anything not being changed. "
        "The greeting must still say it is an AI receptionist.",
        _obj({"name": NS, "greeting": NS}),
    ),
]


@dataclass
class SetupContext:
    org_id: uuid.UUID
    user_id: uuid.UUID
    writes: int = 0


def _err(e: ValidationError | str) -> tuple[bool, str]:
    msg = (
        e
        if isinstance(e, str)
        else "; ".join(f"{'.'.join(map(str, x['loc'])) or 'value'}: {x['msg']}" for x in e.errors())
    )
    return False, json.dumps({"error": msg})


def state(db: Session, org_id: uuid.UUID) -> dict:
    p = db.get(BusinessProfile, org_id)
    s = db.get(WorkspaceSettings, org_id)
    hours = list(
        db.scalars(select(OfficeHours).where(OfficeHours.organization_id == org_id).order_by(OfficeHours.weekday))
    )
    services = list(db.scalars(select(Service).where(Service.organization_id == org_id, Service.active.is_(True))))
    agents = list(db.scalars(select(Agent).where(Agent.organization_id == org_id)))
    return {
        "business": {
            k: getattr(p, k)
            for k in (
                "display_name",
                "sector",
                "phone",
                "email",
                "website",
                "address_line1",
                "city",
                "postcode",
                "description",
            )
        }
        if p
        else {},
        "opening_hours": [f"{DAYS[h.weekday]} {h.opens_at:%H:%M}–{h.closes_at:%H:%M}" for h in hours] or "not set",
        "services": [
            {
                "name": x.name,
                "minutes": x.duration_min,
                "from_gbp": None if x.price_from_pence is None else x.price_from_pence / 100,
                "category": x.category,
            }
            for x in services
        ]
        or "none yet",
        "booking_capacity": s.booking_capacity if s else 1,
        "receptionist": [{"name": a.name, "greeting": a.greeting} for a in agents] or "not created",
        "missing": [
            k
            for k, done in [
                ("phone", bool(p and p.phone)),
                ("address", bool(p and (p.city or p.address_line1))),
                ("opening_hours", bool(hours)),
                ("services", bool(services)),
                ("receptionist", bool(agents)),
            ]
            if not done
        ],
    }


def _find_service(db: Session, org_id: uuid.UUID, name: object) -> Service | str:
    """The one service a name refers to (exact, case-insensitive), or a message saying why not."""
    if not isinstance(name, str) or not name.strip():
        return "give the service's name"
    rows = list(db.scalars(select(Service).where(Service.organization_id == org_id)))
    exact = [s for s in rows if s.name.lower() == name.strip().lower()]
    if exact:
        return exact[0]
    close = sorted(s.name for s in rows if name.strip().lower() in s.name.lower())
    if len(close) == 1:
        return next(s for s in rows if s.name == close[0])
    if close:
        return f"“{name}” could be {', '.join(close)}: ask the owner which one"
    return f"no service called “{name}”: check get_setup_state for the exact names"


def run_tool(db: Session, ctx: SetupContext, name: str, args: object) -> tuple[bool, str]:
    if not isinstance(args, dict):
        return _err("invalid arguments")
    try:
        if name == "get_setup_state":
            return True, json.dumps(state(db, ctx.org_id), default=str)

        if name == "update_business_details":
            p = db.get(BusinessProfile, ctx.org_id)
            assert p is not None
            current = BusinessProfileIO.model_validate(p, from_attributes=True).model_dump()
            changes = {("sector" if k == "business_type" else k): v for k, v in args.items() if v not in (None, "")}
            if "website" in changes and not str(changes["website"]).startswith("https://"):
                changes["website"] = "https://" + str(changes["website"]).removeprefix("http://")
            merged = BusinessProfileIO.model_validate({**current, **changes})
            for k, v in merged.model_dump().items():
                setattr(p, k, v)
            audit.record(
                db,
                ctx.org_id,
                ctx.user_id,
                "business_profile.updated",
                "business_profile",
                ctx.org_id,
                {"fields": sorted(changes), "via": "setup_assistant"},
            )
            db.commit()
            ctx.writes += 1
            return True, json.dumps({"saved": sorted(changes)})

        if name == "set_opening_hours":
            hours = HoursIn.model_validate(
                {
                    "intervals": [
                        {"weekday": d.get("weekday"), "opens_at": d.get("opens"), "closes_at": d.get("closes")}
                        for d in args.get("days", [])
                    ]
                }
            )
            db.execute(delete(OfficeHours).where(OfficeHours.organization_id == ctx.org_id))
            db.add_all(OfficeHours(organization_id=ctx.org_id, **i.model_dump()) for i in hours.intervals)
            audit.record(
                db,
                ctx.org_id,
                ctx.user_id,
                "office_hours.replaced",
                "office_hours",
                None,
                {"intervals": len(hours.intervals), "via": "setup_assistant"},
            )
            db.commit()
            ctx.writes += 1
            return True, json.dumps({"saved_days": sorted({DAYS[i.weekday] for i in hours.intervals}, key=DAYS.index)})

        if name == "add_services":
            existing = {
                n.lower()
                for n in db.scalars(select(func.lower(Service.name)).where(Service.organization_id == ctx.org_id))
            }
            added, skipped = [], []
            for x in args.get("services", []):
                price = x.get("price_from_gbp")
                svc = ServiceIn.model_validate(
                    {
                        "name": x.get("name"),
                        "duration_min": x.get("duration_minutes"),
                        "price_from_pence": None if price is None else round(float(price) * 100),
                        "requires_patch_test": bool(x.get("requires_patch_test")),
                        "category": x.get("category") or None,
                        "buffer_min": x.get("buffer_minutes") or 0,
                    }
                )
                if svc.name.lower() in existing:
                    skipped.append(svc.name)
                    continue
                s = Service(organization_id=ctx.org_id, **svc.model_dump())
                db.add(s)
                db.flush()
                existing.add(svc.name.lower())
                added.append(svc.name)
                audit.record(
                    db,
                    ctx.org_id,
                    ctx.user_id,
                    "service.created",
                    "service",
                    s.id,
                    {"name": s.name, "via": "setup_assistant"},
                )
            db.commit()
            ctx.writes += 1
            return True, json.dumps({"added": added, "already_existed": skipped})

        if name == "update_service":
            s = _find_service(db, ctx.org_id, args.get("name"))
            if isinstance(s, str):
                return _err(s)
            price = args.get("price_from_gbp")
            raw = {
                "name": args.get("new_name"),
                "duration_min": args.get("duration_minutes"),
                "price_from_pence": None if price is None else round(float(price) * 100),
                "category": args.get("category"),
            }
            changes = ServicePatch.model_validate({k: v for k, v in raw.items() if v is not None}).model_dump(
                exclude_unset=True
            )
            if not changes:
                return _err("nothing to change: give a new name, length, price or category")
            if "name" in changes and changes["name"].lower() != s.name.lower():
                taken = db.scalar(
                    select(func.count())
                    .select_from(Service)
                    .where(Service.organization_id == ctx.org_id, func.lower(Service.name) == changes["name"].lower())
                )
                if taken:
                    return _err(f"a service called {changes['name']} already exists")
            for k, v in changes.items():
                setattr(s, k, v)
            audit.record(
                db,
                ctx.org_id,
                ctx.user_id,
                "service.updated",
                "service",
                s.id,
                {"fields": sorted(changes), "via": "setup_assistant"},
            )
            db.commit()
            ctx.writes += 1
            return True, json.dumps({"updated": s.name, "fields": sorted(changes)})

        if name == "remove_services":
            removed, problems = [], []
            for n in args.get("names", []):
                s = _find_service(db, ctx.org_id, n)
                if isinstance(s, str):
                    problems.append(s)
                    continue
                removed.append(s.name)
                db.delete(s)
                audit.record(
                    db,
                    ctx.org_id,
                    ctx.user_id,
                    "service.deleted",
                    "service",
                    s.id,
                    {"name": s.name, "via": "setup_assistant"},
                )
            db.commit()
            ctx.writes += 1 if removed else 0
            return True, json.dumps({"removed": removed, "problems": problems})

        if name == "get_business_template":
            t = template(str(args.get("business_type")))
            if t is None:
                return True, json.dumps({"template": None})
            return True, json.dumps(
                {
                    "template": {
                        "label": t["label"],
                        "services": [
                            {
                                "name": s["name"],
                                "category": s["category"],
                                "duration_minutes": s["duration_min"],
                                "buffer_minutes": s["buffer_min"],
                                "price_from_gbp": s["price_from_pence"] / 100,
                            }
                            for s in t["services"]
                        ],
                        "opening_hours": [
                            {"weekday": d, "opens": p["opens"], "closes": p["closes"]}
                            for d, periods in enumerate(t["week"])
                            for p in periods
                        ],
                        "policies_description": t["description"],
                        "note": "Starting prices at typical UK high-street rates. Show the owner and let them edit "
                        "before saving anything.",
                    }
                }
            )

        if name == "set_booking_capacity":
            n = args.get("capacity")
            if not isinstance(n, int) or not 1 <= n <= 50:
                return _err("capacity must be a whole number from 1 to 50")
            s = db.get(WorkspaceSettings, ctx.org_id)
            assert s is not None
            s.booking_capacity = n
            audit.record(
                db,
                ctx.org_id,
                ctx.user_id,
                "settings.updated",
                "workspace_settings",
                ctx.org_id,
                {"to": {"booking_capacity": n}, "via": "setup_assistant"},
            )
            db.commit()
            ctx.writes += 1
            return True, json.dumps({"booking_capacity": n})

        if name == "create_receptionist":
            body = AgentIn.model_validate({"name": args.get("name"), "greeting": args.get("greeting")})
            a = Agent(organization_id=ctx.org_id, created_by=ctx.user_id, **body.model_dump())
            db.add(a)
            db.flush()
            audit.record(
                db, ctx.org_id, ctx.user_id, "agent.created", "agent", a.id, {"name": a.name, "via": "setup_assistant"}
            )
            db.commit()
            ctx.writes += 1
            return True, json.dumps({"created": a.name})

        if name == "update_receptionist":
            a = db.scalars(select(Agent).where(Agent.organization_id == ctx.org_id).order_by(Agent.created_at)).first()
            if a is None:
                return _err("there is no receptionist yet: use create_receptionist")
            changes = AgentPatch.model_validate(
                {k: v for k, v in {"name": args.get("name"), "greeting": args.get("greeting")}.items() if v}
            ).model_dump(exclude_unset=True)
            if not changes:
                return _err("nothing to change: give a new name or greeting")
            before = {k: getattr(a, k) for k in changes}
            for k, v in changes.items():
                setattr(a, k, v)
            audit.record(
                db,
                ctx.org_id,
                ctx.user_id,
                "agent.updated",
                "agent",
                a.id,
                {"fields": sorted(changes), "via": "setup_assistant"},
            )
            db.commit()
            ctx.writes += 1
            return True, json.dumps({"before": before, "after": changes})

        return _err(f"unknown tool {name}")
    except ValidationError as e:
        db.rollback()
        return _err(e)
    except (TypeError, ValueError) as e:
        db.rollback()
        return _err(str(e))
