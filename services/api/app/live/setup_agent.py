"""The setup assistant: a Claude agent that sets a workspace up by conversation.

It can only change setup data (business details, hours, services, capacity, the receptionist)
and every write goes through the same validation schemas as the REST API, is audited against
the signed-in owner/admin, and is scoped to their workspace by RLS.
"""

import json
import uuid
from dataclasses import dataclass

from pydantic import ValidationError
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .. import audit
from ..models import Agent, BusinessProfile, OfficeHours, Service, WorkspaceSettings
from ..schemas import AgentIn, BusinessProfileIO, HoursIn, ServiceIn

SECTORS = [
    "hair_beauty",
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


def system_prompt(business_name: str) -> str:
    return f"""You are the VOXERA setup assistant, helping the owner of {business_name} get their AI phone \
receptionist ready. You are friendly, calm and brief: plain sentences, no jargon, one question at a time.

Start by calling get_setup_state to see what's already done, then work through what's missing, roughly in this \
order: type of business, phone, address, opening hours, services (name, how long, starting price), how many \
customers can be seen at once, and the receptionist's name and greeting.

When the owner tells you something, read back your interpretation in one short line, then save it with the \
right tool straight away (they can always correct you). Never invent details they haven't given — ask instead. \
If a tool returns an error, explain it simply and ask for what's needed. Prices are in pounds; times are 24-hour.
The receptionist's greeting must say it is an AI receptionist (UK rules on disclosure).

When everything is set, say so and suggest the next steps: go Available on the Desk, invite the team on the \
Team page, and try a test call in the Voice lab. Only help with setting up this workspace."""


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
        "Replace the whole week. Days not listed are closed. weekday: 0 = Monday … 6 = Sunday; times HH:MM.",
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
                        }
                    ),
                }
            }
        ),
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

        return _err(f"unknown tool {name}")
    except ValidationError as e:
        db.rollback()
        return _err(e)
    except (TypeError, ValueError) as e:
        db.rollback()
        return _err(str(e))
