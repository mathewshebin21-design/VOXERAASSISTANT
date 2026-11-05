"""Runs a conversation flow, one caller message at a time.

Deterministic by design. The caller's words are interpreted by rules (intent, yes/no, names,
phone numbers, dates, times, services); everything the receptionist states comes from the
workspace's own data; availability and bookings go through the same functions as the REST API
(app/reception.py), so a flow cannot offer a time the diary doesn't have or skip a booking rule.

Modes:
- "simulation" / "test": every action runs for real inside a database savepoint that is rolled
  back, so validation is identical but nothing is written (no booking, no case, no presence change);
- "live": actions are committed.
"""

import re
import time as clock
import uuid
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import reception
from ..live.receptionist import BusinessContext, load_context
from ..models import Appointment, AppointmentStatus, CallerMessageKind, Role, Service
from .schema import (
    INTENTS,
    NODE_SETTINGS,
    AskSettings,
    AvailabilitySettings,
    CollectSettings,
    ConditionSettings,
    Flow,
    KnowledgeSettings,
    Node,
    ServiceLookupSettings,
    ToolSettings,
    TransferSettings,
)

MAX_STEPS_PER_TURN = 25
WAITING_TYPES = {"start", "ask", "availability", "booking", "collect_info", "tool"}

# ---------------------------------------------------------------- understanding the caller

INJECTION = re.compile(
    r"(ignore (all |your |the )?(previous|prior|above) (instructions|rules)|system prompt|you are now|"
    r"developer mode|reveal (your|the) (prompt|instructions)|act as an?)",
    re.I,
)
URGENT = re.compile(r"(allergic reaction|can'?t breathe|chest pain|bleeding heavily|emergency|chemical burn)", re.I)
YES = re.compile(
    r"^\W*(yes|yeah|yep|yup|yes please|correct|that'?s (right|correct|fine|perfect)|go ahead|confirm(ed)?|"
    r"book (it|me in|that)|please do|do it|sounds good|perfect|ok(ay)?|sure|absolutely|definitely|lovely)\b",
    re.I,
)
NO = re.compile(
    r"^\W*(no|nope|nah|not really|neither|none of (those|them)|don'?t|cancel that|wait|nothing|"
    r"that'?s (all|it|everything))\b",
    re.I,
)
HEDGE = re.compile(r"\b(actually|wait|hang on|hold on|not sure|maybe)\b", re.I)


def classify(text: str) -> str:
    t = text.lower()
    if re.search(r"\b(speak|talk) (to|with)\b|\b(a|real) (person|human)\b|\bmanager\b|\bsomeone\b|put me through", t):
        return "human"
    if re.search(r"\b(cancel|can'?t make it|can not make it)\b", t):
        return "cancel"
    if re.search(r"\b(reschedul|move my|change my|different (day|time) for my|push (it|my))", t):
        return "reschedule"
    if re.search(r"\b(book|appointment|slot|availability|available|come in|get in|reserve|schedule)\b", t):
        return "book"
    if "?" in t or re.match(
        r"^\W*(what|whats|what's|how|when|where|which|who|do you|are you|is there|can you|tell me)", t
    ):
        return "question"
    return "other"


def affirmed(text: str) -> bool:
    return bool(YES.search(text)) and not HEDGE.search(text) and not text.strip().endswith("?")


def denied(text: str) -> bool:
    return bool(NO.search(text))


def extract_name(text: str) -> str | None:
    m = re.search(
        r"(?:my name is|i'?m|it'?s|this is|name'?s|call me|under)\s+([A-Za-z][A-Za-z'-]+(?:\s+[A-Za-z][A-Za-z'-]+)?)",
        text,
        re.I,
    )
    if not m and len(text.split()) <= 3:
        m = re.match(r"^\s*([A-Za-z][A-Za-z'-]+(?:\s+[A-Za-z][A-Za-z'-]+)?)[.!]?\s*$", text)
    if not m or affirmed(m.group(1)) or denied(m.group(1)):
        return None
    return " ".join(w.capitalize() for w in m.group(1).split())


def extract_phone(text: str) -> str | None:
    digits = re.sub(r"[^\d+]", "", text)
    return digits if 10 <= len(digits.lstrip("+")) <= 13 else None


DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def extract_date(text: str, today: date) -> date | None:
    t = text.lower()
    if re.search(r"\btoday\b", t):
        return today
    if re.search(r"\btomorrow\b", t):
        return today + timedelta(days=1)
    for i, d in enumerate(DAYS):
        if re.search(rf"\b{d}|\b{d[:3]}\b", t):
            return today + timedelta(days=(i - today.weekday()) % 7 or 7)
    m = re.search(r"\b(\d{1,2})(st|nd|rd|th)\b", t)
    if m:
        day = int(m.group(1))
        for add in range(0, 62):
            cand = today + timedelta(days=add)
            if cand.day == day:
                return cand
    return None


def extract_time(text: str) -> tuple[int, int] | None:
    m = re.search(r"\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b|\b(\d{1,2})[:.](\d{2})\b", text.lower())
    if not m:
        return None
    if m.group(1):
        h, mi = int(m.group(1)), int(m.group(2) or 0)
        h = h % 12 + (12 if m.group(3) == "pm" else 0)
    else:
        h, mi = int(m.group(4)), int(m.group(5))
        if h < 8:
            h += 12
    return (h, mi) if h < 24 and mi < 60 else None


def part_of_day(text: str) -> str:
    t = text.lower()
    for p in ("morning", "afternoon", "evening"):
        if p in t:
            return p
    return "any"


def words(s: str) -> list[str]:
    return [re.sub(r"(ings|ing|es|s)$", "", w) for w in re.findall(r"[a-z0-9]+", s.lower().replace("colour", "color"))]


STOP = {
    "and",
    "the",
    "with",
    "for",
    "of",
    "a",
    "an",
    "to",
    "in",
    "on",
    "my",
    "your",
    "book",
    "like",
    "want",
    "please",
    "can",
    "get",
}


def match_services(text: str, services: list[Service]) -> list[Service]:
    said = set(words(text)) - STOP
    scored = []
    for s in services:
        name = [w for w in words(s.name) if w not in STOP and len(w) > 2]
        if not name:
            continue
        whole = " ".join(words(s.name)) in " ".join(words(text))
        hits = sum(w in said for w in name)
        if whole or hits:
            scored.append((100 if whole else hits / len(name), s))
    if not scored:
        return []
    best = max(sc for sc, _ in scored)
    return [s for sc, s in scored if sc == best]


# ---------------------------------------------------------------- running a flow


@dataclass
class Runtime:
    db: Session
    org_id: uuid.UUID
    mode: str  # "simulation" | "test" | "live"
    now: datetime | None = None
    caller_phone: str | None = None
    fail_tools: bool = False  # tests: make every action fail, to check recovery paths
    force_hours: str | None = None  # tests: "open" / "closed" regardless of the clock
    no_staff: bool = False  # tests: behave as if nobody on the team is available
    ctx: BusinessContext | None = None

    def __post_init__(self) -> None:
        self.ctx = self.ctx or load_context(self.db, self.org_id)
        self.desk = reception.desk(self.db, self.org_id)

    @property
    def dry(self) -> bool:
        return self.mode != "live"

    def local_now(self) -> datetime:
        return (self.now or datetime.now(UTC)).astimezone(self.desk.tz)


@dataclass
class Turn:
    events: list[dict] = field(default_factory=list)

    def say(self, text: str, node: str) -> None:
        self.events.append({"type": "say", "text": text, "node": node})

    def node(self, node: Node) -> None:
        self.events.append({"type": "node", "node": node.id, "kind": node.type, "label": node.label or node.id})

    def tool(self, name: str, node: str, ok: bool, args: dict, result: str, ms: float, written: bool) -> None:
        self.events.append(
            {
                "type": "tool",
                "name": name,
                "node": node,
                "ok": ok,
                "args": args,
                "result": result,
                "latency_ms": round(ms, 1),
                "written": written,
            }
        )

    def guard(self, rule: str, text: str, node: str | None) -> None:
        self.events.append({"type": "guardrail", "rule": rule, "text": text, "node": node})

    def evidence(self, source: str, value: str, node: str) -> None:
        self.events.append({"type": "evidence", "source": source, "value": value, "node": node})


def new_state() -> dict:
    return {"node": None, "waiting": False, "vars": {}, "turns": 0, "ended": False, "outcome": None, "sub": {}}


class Engine:
    def __init__(self, flow: Flow, rt: Runtime):
        self.flow = flow
        self.rt = rt
        self.nodes = {n.id: n for n in flow.nodes}
        self.edges = {(e.source, e.outcome): e.target for e in flow.edges}
        self.settings = {n.id: NODE_SETTINGS[n.type].model_validate(n.settings) for n in flow.nodes}

    # -- public ---------------------------------------------------------------------------

    def start(self, state: dict) -> list[dict]:
        t = Turn()
        start = next(n for n in self.flow.nodes if n.type == "start")
        state.update(node=start.id, waiting=True)
        state["vars"].update(caller_phone=self.rt.caller_phone or "", now_local=self.rt.local_now().isoformat())
        t.node(start)
        c = self.rt.ctx
        greeting = self.settings[start.id].greeting.replace("{business}", c.name).replace("{agent}", "the receptionist")
        if c.disclosure:
            greeting = f"{greeting} {c.disclosure}"
        t.say(greeting, start.id)
        return t.events

    def turn(self, state: dict, text: str) -> list[dict]:
        t = Turn()
        if state.get("ended"):
            t.guard("call_ended", "The call has already ended.", None)
            return t.events
        text = text.strip()[:1000]
        state["turns"] += 1
        state["vars"]["last_message"] = text
        node = self.nodes.get(state["node"])
        if node is None:
            raise ValueError("unknown node in state")
        if state["turns"] > self.flow.settings.max_turns:
            t.guard("max_turns", "The conversation ran too long; handing over to the team.", node.id)
            self._finish(
                state, t, "too_long", "I'm sorry, let me pass this to the team so someone can help you properly."
            )
            return t.events
        # Global rules, whatever node we're on.
        if INJECTION.search(text):
            t.guard("instruction_override", "Caller tried to change the receptionist's instructions. Ignored.", node.id)
            t.say(f"I can only help with {self.rt.ctx.name} bookings and questions. What can I do for you?", node.id)
            return t.events
        if URGENT.search(text):
            t.guard("urgent_safety", "Possible emergency. No advice given; escalated.", node.id)
            t.say(
                "If this is an emergency please hang up and call 999 now. I'll alert the team straight away.", node.id
            )
            self._handoff(state, t, node, "possible emergency mentioned by caller", urgent=True, kind="escalate")
            self._finish(state, t, "escalated", None)
            return t.events
        intent = classify(text)
        state["vars"]["intent"] = intent
        if intent == "human" and node.type != "transfer":  # a caller asking for a person is always heard
            transfers = [n for n in self.flow.nodes if n.type == "transfer"]
            managers = [n for n in transfers if self.settings[n.id].target == "managers"]
            wants_manager = re.search(r"\b(manager|owner|boss|in charge)\b", text, re.I)
            target = (
                (managers or transfers)[0]
                if wants_manager and transfers
                else next(
                    (n for n in transfers if self.settings[n.id].target != "managers"),
                    transfers[0] if transfers else None,
                )
            )
            if target is not None:
                t.guard("asked_for_person", "Caller asked for a person; going to the transfer step.", node.id)
                state.update(node=target.id, waiting=False, sub={})
                self._run(state, t)
                return t.events
        if state.get("waiting") and intent == "question" and self._side_question(state, t, node, text):
            return t.events
        self._resume(state, t, node, text)
        self._run(state, t)
        return t.events

    def _side_question(self, state: dict, t: Turn, node: Node, text: str) -> bool:
        """A question asked in the middle of something else is answered, then we carry on."""
        if node.type not in ("availability", "booking") and not (
            node.type == "ask" and self.settings[node.id].kind not in ("text", "service")
        ):
            return False
        found = self._answer(text, KnowledgeSettings().topics)
        if not found:
            return False
        answer, source = found
        t.evidence(source, answer, node.id)
        back = {
            "availability": "Now, which of those times suits you?",
            "booking": "Shall I go ahead and book it?",
        }.get(node.type) or self.settings[node.id].question
        t.say(f"{answer} {back}", node.id)
        return True

    # -- waiting nodes ----------------------------------------------------------------------

    def _resume(self, state: dict, t: Turn, node: Node, text: str) -> None:
        s = self.settings[node.id]
        sub = state.setdefault("sub", {})
        if node.type == "start":
            return self._go(state, node, "next")
        if node.type == "ask":
            value = self._extract(s, text)
            if value is not None:
                state["vars"][s.variable] = value
                state["sub"] = {}
                return self._go(state, node, "answered")
            tries = sub.get("tries", 0) + 1
            if tries > s.retries:
                state["sub"] = {}
                return self._go(state, node, "no_answer")
            sub["tries"] = tries
            t.say(f"Sorry, I didn't catch that. {s.question}", node.id)
            return None
        if node.type == "availability":
            switched = match_services(text, self._active_services())
            if len(switched) == 1 and str(switched[0].id) != state["vars"].get("service_id"):
                # "Actually, make it a beard trim": change the service and look again.
                state["vars"].update(service=switched[0].name, service_id=str(switched[0].id))
                t.guard("changed_request", f"Caller switched to {switched[0].name}.", node.id)
                state.update(waiting=False, sub={})
                return None
            choice = self._pick(sub.get("offered", []), text)
            if choice:
                state["vars"]["slot"] = choice
                state["sub"] = {}
                return self._go(state, node, "available")
            if denied(text) or sub.get("asked_again"):
                state["sub"] = {}
                return self._go(state, node, "none")
            sub["asked_again"] = True
            t.say("Which of those times would suit you best?", node.id)
            return None
        if node.type == "collect_info":
            return self._collect(state, t, node, s, text)
        if node.type == "booking":
            if sub.get("need") == "name":
                name = extract_name(text)
                if not name:
                    t.say("Sorry, could I take your name for the booking?", node.id)
                    return None
                state["vars"]["customer_name"] = name
                sub.pop("need")
                return self._ask_confirmation(state, t, node)
            if affirmed(text):
                return self._book(state, t, node)
            if denied(text) or sub.get("asked_again"):
                t.say("No problem, I won't book that.", node.id)
                state["sub"] = {}
                return self._go(state, node, "declined")
            sub["asked_again"] = True
            t.say("Shall I go ahead and book it? Just say yes or no.", node.id)
            return None
        if node.type == "tool":
            return self._tool_reply(state, t, node, s, text)
        return None

    def _extract(self, s: AskSettings, text: str):
        today = self.rt.local_now().date()
        if s.kind == "name":
            return extract_name(text)
        if s.kind == "phone":
            return extract_phone(text)
        if s.kind == "date":
            d = extract_date(text, today)
            return d.isoformat() if d else None
        if s.kind == "time":
            tm = extract_time(text)
            return f"{tm[0]:02d}:{tm[1]:02d}" if tm else None
        if s.kind == "yes_no":
            return "yes" if affirmed(text) else "no" if denied(text) else None
        if s.kind == "choice":
            low = text.lower()
            return next((c for c in s.choices if c.lower() in low), None)
        return text if text else None  # text, service: the raw words (service_lookup matches them)

    # -- automatic nodes --------------------------------------------------------------------

    def _run(self, state: dict, t: Turn) -> None:
        for _ in range(MAX_STEPS_PER_TURN):
            if state.get("ended") or state.get("waiting"):
                return
            node = self.nodes[state["node"]]
            t.node(node)
            s = self.settings[node.id]
            if node.type in ("start",):
                state["waiting"] = True
            elif node.type == "ask":
                t.say(s.question, node.id)
                state["waiting"] = True
            elif node.type == "respond":
                t.say(self._fill(s.message, state), node.id)
                self._go(state, node, "next")
            elif node.type == "knowledge":
                self._knowledge(state, t, node, s)
            elif node.type == "condition":
                self._go(state, node, self._condition(state, s))
            elif node.type == "hours_check":
                is_open = (
                    self.rt.force_hours == "open"
                    if self.rt.force_hours
                    else reception.is_open(self.rt.db, self.rt.desk, self.rt.now)
                )
                t.evidence("opening_hours", "open now" if is_open else "closed now", node.id)
                self._go(state, node, "open" if is_open else "closed")
            elif node.type == "service_lookup":
                self._service_lookup(state, t, node, s)
            elif node.type == "availability":
                self._availability(state, t, node, s)
            elif node.type == "booking":
                if not state["vars"].get("customer_name"):
                    state["sub"] = {"need": "name"}
                    t.say("Lovely. What name shall I put the booking under?", node.id)
                    state["waiting"] = True
                else:
                    self._ask_confirmation(state, t, node)
            elif node.type == "collect_info":
                state["sub"] = {"i": 0}
                t.say(self._collect_prompt(s.fields[0]), node.id)
                state["waiting"] = True
            elif node.type == "tool":
                self._tool(state, t, node, s)
            elif node.type == "escalate":
                self._handoff(state, t, node, s.reason, urgent=s.urgent, kind="escalate")
                self._go(state, node, "handed_off")
            elif node.type == "transfer":
                self._transfer(state, t, node, s)
            elif node.type == "end":
                self._finish(state, t, state.get("outcome") or "completed", self._fill(s.message, state))
        else:
            t.guard("step_limit", "The flow went round too many steps in one turn; stopping.", state["node"])
            self._finish(state, t, "error", "Sorry, something's gone wrong on my side. Let me pass you to the team.")

    def _go(self, state: dict, node: Node, outcome: str) -> None:
        nxt = self.edges.get((node.id, outcome))
        if nxt is None:  # only possible for an unpublished, invalid draft
            raise ValueError(f"{node.id} has no connection for {outcome}")
        state.update(node=nxt, waiting=False)

    def _fill(self, msg: str, state: dict) -> str:
        v = {"business": self.rt.ctx.name, **{k: str(x) for k, x in state["vars"].items()}}
        return re.sub(r"\{([a-z_]+)\}", lambda m: v.get(m.group(1), m.group(0)), msg)

    def _condition(self, state: dict, s: ConditionSettings) -> str:
        vars_ = state["vars"]
        for r in s.rules:
            val = str(vars_.get(r.variable, "") or "").lower()
            want = r.value.lower()
            ok = {
                "equals": val == want,
                "not_equals": val != want,
                "contains": want in val,
                "is_set": bool(val),
                "is_not_set": not val,
                "in": val in [x.strip() for x in want.split(",")],
                "is_yes": affirmed(val),
                "is_no": denied(val),
                "time_after": self._clock(r.variable, state) >= want,
                "time_before": self._clock(r.variable, state) < want,
            }[r.op]
            if ok:
                return r.id
        return "else"

    def _clock(self, variable: str, state: dict) -> str:
        """HH:MM for time conditions: the call's local time, or a time the caller gave."""
        if variable == "now_local":
            return self.rt.local_now().strftime("%H:%M")
        return str(state["vars"].get(variable, "") or "")[:5]

    def _knowledge(self, state: dict, t: Turn, node: Node, s: KnowledgeSettings) -> None:
        found = self._answer(state["vars"].get("last_message", ""), s.topics)
        if found:
            answer, source = found
            t.evidence(source, answer, node.id)
            t.say(answer, node.id)
            self._go(state, node, "answered")
        else:
            t.guard("unsupported_answer", "Nothing in the workspace's details answers that. Not guessing.", node.id)
            t.say("I don't have that information to hand, and I'd rather not guess.", node.id)
            self._go(state, node, "not_found")

    def _answer(self, question: str, topics: list[str]) -> tuple[str, str] | None:
        """An answer built only from the workspace's own data, and where it came from."""
        q = question.lower()
        c = self.rt.ctx
        info, hours, services = c.info, c.hours.get("weekly", {}), c.services
        answer, source = None, None
        named = [x for x in services if any(w in words(q) for w in words(x["name"]) if len(w) > 3)]
        if "prices" in topics and re.search(r"how much|price|cost|£", q) and (named or services):
            pick = named or services
            parts = [f"{x['name']} is from £{x['price_from_gbp']}" for x in pick[:5] if x["price_from_gbp"]]
            if parts:
                answer, source = "; ".join(parts) + ".", "services.price_from"
        elif "hours" in topics and re.search(r"open|close|hours|what time", q):
            open_days = [f"{d} {', '.join(v)}" for d, v in hours.items() if v]
            if open_days:
                answer, source = "We're open " + "; ".join(open_days) + ".", "office_hours"
        elif (
            "address" in topics
            and re.search(r"where|address|located|find you|postcode|parking", q)
            and info.get("address")
        ):
            answer, source = f"We're at {info['address']}.", "business_profile.address"
        elif "phone" in topics and re.search(r"phone|number|call you", q) and info.get("phone"):
            answer, source = f"You can reach us on {info['phone']}.", "business_profile.phone"
        elif "services" in topics and (re.search(r"what (services|do you (do|offer))|services|menu", q) or named):
            pick = named or services
            if pick:
                answer = "We offer " + ", ".join(x["name"] for x in pick[:10]) + "."
                if named and named[0]["duration_minutes"]:
                    answer = f"{named[0]['name']} takes about {named[0]['duration_minutes']} minutes" + (
                        f" and starts from £{named[0]['price_from_gbp']}." if named[0]["price_from_gbp"] else "."
                    )
                source = "services"
        elif (
            "description" in topics
            and re.search(r"who are you|what is this|about (you|the business)", q)
            and info.get("description")
        ):
            answer, source = info["description"], "business_profile.description"
        return (answer, source) if answer else None

    def _active_services(self) -> list[Service]:
        return list(
            self.rt.db.scalars(
                select(Service).where(Service.organization_id == self.rt.org_id, Service.active.is_(True))
            )
        )

    def _service_lookup(self, state: dict, t: Turn, node: Node, s: ServiceLookupSettings) -> None:
        said = str(state["vars"].get(s.from_variable, "") or "")
        found = match_services(said, self._active_services())
        t.tool(
            "service_lookup",
            node.id,
            True,
            {"text": said[:80]},
            ", ".join(x.name for x in found) or "no match",
            0,
            False,
        )
        if len(found) == 1:
            state["vars"].update(service=found[0].name, service_id=str(found[0].id))
            self._go(state, node, "found")
        elif found:
            names = [x.name for x in found]
            state["vars"]["service_choices"] = ", ".join(names)
            t.say(f"We have a few of those: {', '.join(names[:-1])} or {names[-1]}.", node.id)
            self._go(state, node, "ambiguous")
        else:
            self._go(state, node, "not_found")

    def _availability(self, state: dict, t: Turn, node: Node, s: AvailabilitySettings) -> None:
        svc = self._service(state)
        if svc is None:
            t.guard("missing_service", "No service chosen before checking availability.", node.id)
            return self._go(state, node, "none")
        said = state["vars"].get("last_message", "")
        on = extract_date(said, self.rt.local_now().date())
        part = part_of_day(said) if s.part_of_day == "from_caller" else s.part_of_day
        started = clock.perf_counter()
        if self.rt.fail_tools:
            t.tool("check_availability", node.id, False, {"service": svc.name}, "diary unavailable (test)", 0, False)
            t.say("I'm sorry, I can't see the diary right now.", node.id)
            return self._go(state, node, "none")
        slots = reception.available_slots(
            self.rt.db, self.rt.desk, svc, on, part, self.rt.now, limit=s.offer + 6 * bool(s.exclude_weekdays)
        )
        if s.exclude_weekdays:  # the flow's own booking rule, e.g. "no appointments on Sundays"
            slots = [x for x in slots if x.weekday() not in s.exclude_weekdays][: s.offer]
        ms = (clock.perf_counter() - started) * 1000
        t.tool(
            "check_availability",
            node.id,
            True,
            {"service": svc.name, "on": on.isoformat() if on else None, "part_of_day": part},
            f"{len(slots)} free time(s)",
            ms,
            False,
        )
        if not slots:
            t.say(f"I'm afraid I can't see a free time for {svc.name}{' that day' if on else ''}.", node.id)
            return self._go(state, node, "none")
        offered = [x.isoformat() for x in slots]
        state["sub"] = {"offered": offered}
        spoken = [reception.spoken_time(x) for x in slots]
        joined = spoken[0] if len(spoken) == 1 else ", ".join(spoken[:-1]) + f" or {spoken[-1]}"
        t.evidence("availability", "; ".join(offered), node.id)
        t.say(f"I could do {joined}. Which suits you?", node.id)
        state["waiting"] = True

    def _pick(self, offered: list[str], text: str) -> str | None:
        if not offered:
            return None
        low = text.lower()
        for i, word in enumerate(["first", "second", "third", "fourth", "fifth"]):
            if word in low and i < len(offered):
                return offered[i]
        if re.search(r"\b(last|latest|later one)\b", low):
            return offered[-1]
        tm = extract_time(text)
        if tm:
            hit = [o for o in offered if (datetime.fromisoformat(o).hour, datetime.fromisoformat(o).minute) == tm]
            if hit:
                return hit[0]
        d = extract_date(text, self.rt.local_now().date())
        if d:
            same = [o for o in offered if datetime.fromisoformat(o).date() == d]
            if len(same) == 1:
                return same[0]
        if len(offered) == 1 and affirmed(text):
            return offered[0]
        return None

    def _service(self, state: dict) -> Service | None:
        sid = state["vars"].get("service_id")
        if not sid:
            return None
        return self.rt.db.scalar(
            select(Service).where(Service.id == uuid.UUID(sid), Service.organization_id == self.rt.org_id)
        )

    def _ask_confirmation(self, state: dict, t: Turn, node: Node) -> None:
        v = state["vars"]
        when = reception.spoken_time(datetime.fromisoformat(v["slot"])) if v.get("slot") else "the time you chose"
        t.say(
            f"So that's {v.get('service', 'your appointment')} on {when}, for {v['customer_name']}. Shall I book it?",
            node.id,
        )
        state["sub"] = {}
        state["waiting"] = True

    def _book(self, state: dict, t: Turn, node: Node) -> None:
        v = state["vars"]
        svc = self._service(state)
        phone = v.get("customer_phone") or v.get("caller_phone") or ""
        args = {"service": v.get("service"), "start": v.get("slot"), "name": v.get("customer_name"), "phone": phone}
        state["sub"] = {}
        if svc is None or not v.get("slot"):
            t.tool("book_appointment", node.id, False, args, "missing service or time", 0, False)
            return self._go(state, node, "failed")
        if not phone:  # bookings need a contact number; in a simulation there is no caller ID
            phone = "07700900000" if self.rt.dry else ""
        started = clock.perf_counter()
        try:
            if self.rt.fail_tools:
                raise reception.DeskError("diary unavailable (test)")
            with self._effects():
                appt, _ = reception.book(
                    self.rt.db,
                    self.rt.desk,
                    svc,
                    datetime.fromisoformat(v["slot"]),
                    v["customer_name"],
                    phone,
                    None,
                    "ai_receptionist",
                    f"flow:{state.get('session')}:{svc.id}:{v['slot']}",
                    self.rt.now,
                )
                ref = str(appt.id)[:8]
        except reception.DeskError as e:
            t.tool("book_appointment", node.id, False, args, str(e), (clock.perf_counter() - started) * 1000, False)
            t.say("I'm sorry, I couldn't book that.", node.id)
            return self._go(state, node, "failed")
        written = not self.rt.dry
        t.tool(
            "book_appointment",
            node.id,
            True,
            args,
            f"booked {ref}" if written else "valid booking (simulation: not saved)",
            (clock.perf_counter() - started) * 1000,
            written,
        )
        state["vars"]["booking_ref"] = ref
        state["outcome"] = "booked"
        t.say(
            f"You're booked in for {v.get('service')} on {reception.spoken_time(datetime.fromisoformat(v['slot']))}.",
            node.id,
        )
        self._go(state, node, "booked")

    def _effects(self):
        """Writes for real in live mode; inside a rolled-back savepoint otherwise."""
        rt = self.rt

        class _Ctx:
            def __enter__(self_inner):
                self_inner.sp = rt.db.begin_nested()
                return self_inner

            def __exit__(self_inner, exc_type, exc, tb):
                if exc_type is not None or rt.dry:
                    self_inner.sp.rollback()
                else:
                    self_inner.sp.commit()
                    rt.db.commit()
                return False

        return _Ctx()

    def _handoff(self, state: dict, t: Turn, node: Node, reason: str, *, urgent: bool, kind: str, roles=None) -> str:
        v = state["vars"]
        summary = f"{reason}. Caller said: {v.get('last_message', '')}"[:500]
        started = clock.perf_counter()
        try:
            if self.rt.fail_tools:
                raise reception.DeskError("desk unavailable (test)")
            with self._effects():
                if kind == "escalate":
                    reception.leave_message(
                        self.rt.db,
                        self.rt.desk,
                        CallerMessageKind.message,
                        summary,
                        v.get("customer_name"),
                        v.get("customer_phone") or v.get("caller_phone"),
                        reason,
                        urgent,
                    )
                    outcome, staff = "queued", None
                else:
                    h = reception.hand_off(
                        self.rt.db,
                        self.rt.desk,
                        summary,
                        reason,
                        v.get("customer_name"),
                        v.get("customer_phone") or v.get("caller_phone"),
                        urgent,
                        self.rt.now,
                        roles=roles,
                    )
                    outcome, staff = h.outcome, h.staff_name
        except reception.DeskError as e:
            t.tool(kind, node.id, False, {"reason": reason}, str(e), (clock.perf_counter() - started) * 1000, False)
            return "failed"
        result = outcome if not staff else f"{outcome} to {staff}"
        t.tool(
            kind,
            node.id,
            True,
            {"reason": reason, "urgent": urgent},
            result if not self.rt.dry else f"{result} (simulation: nothing saved)",
            (clock.perf_counter() - started) * 1000,
            not self.rt.dry,
        )
        if kind == "escalate":
            t.say("I've passed that to the team and someone will get back to you.", node.id)
            state["outcome"] = state.get("outcome") or "message_taken"
        state["vars"]["handoff"] = outcome
        state["vars"]["handoff_staff"] = staff or ""
        return outcome

    def _transfer(self, state: dict, t: Turn, node: Node, s: TransferSettings) -> None:
        roles = (Role.owner, Role.admin, Role.manager) if s.target == "managers" else None
        if self.rt.no_staff:
            roles = ()
        outcome = self._handoff(state, t, node, "caller asked for a person", urgent=False, kind="transfer", roles=roles)
        if outcome == "transferred":
            staff = state["vars"].get("handoff_staff") or "the team"
            t.say(f"{s.message} I'm putting you through to {staff} now.", node.id)
            state["outcome"] = "transferred"
            self._go(state, node, "transferred")
        else:
            t.say("Everyone's busy at the moment.", node.id)
            self._go(state, node, "unavailable")

    def _collect_prompt(self, f: str) -> str:
        return {
            "name": "Could I take your name?",
            "phone": "And the best number to reach you on?",
            "email": "What's your email address?",
            "notes": "Is there anything else the team should know?",
        }[f]

    def _collect(self, state: dict, t: Turn, node: Node, s: CollectSettings, text: str) -> None:
        sub = state["sub"]
        i = sub.get("i", 0)
        f = s.fields[i]
        val = {
            "name": extract_name(text),
            "phone": extract_phone(text),
            "email": (re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", text) or [None])[0],
            "notes": text or None,
        }[f]
        if val is None:
            if sub.get("retry") == i:
                state["sub"] = {}
                return self._go(state, node, "incomplete")
            sub["retry"] = i
            t.say(f"Sorry, I didn't catch that. {self._collect_prompt(f)}", node.id)
            return None
        state["vars"]["customer_name" if f == "name" else "customer_phone" if f == "phone" else f] = val
        if i + 1 < len(s.fields):
            sub["i"] = i + 1
            t.say(self._collect_prompt(s.fields[i + 1]), node.id)
            return None
        state["sub"] = {}
        return self._go(state, node, "collected")

    def _tool(self, state: dict, t: Turn, node: Node, s: ToolSettings) -> None:
        v = state["vars"]
        phone = v.get("customer_phone") or v.get("caller_phone") or ""
        if s.tool == "take_message":
            ok = self._handoff(state, t, node, "message for the team", urgent=False, kind="escalate") != "failed"
            return self._go(state, node, "success" if ok else "failure")
        if s.tool == "reschedule_appointment":
            t.tool(s.tool, node.id, False, {}, "not available in flows yet: route to Escalate", 0, False)
            return self._go(state, node, "failure")
        if not phone:
            t.tool(s.tool, node.id, False, {}, "no caller number to look up bookings", 0, False)
            return self._go(state, node, "failure")
        rows = reception.upcoming_for_phone(self.rt.db, self.rt.desk, phone, self.rt.now)
        t.tool(s.tool, node.id, True, {"phone": "caller"}, f"{len(rows)} upcoming booking(s)", 0, False)
        if s.tool == "find_my_appointments":
            if rows:
                t.say(
                    "I can see "
                    + "; ".join(
                        f"{a.service_name} on {reception.spoken_time(a.starts_at.astimezone(self.rt.desk.tz))}"
                        for a in rows[:3]
                    )
                    + ".",
                    node.id,
                )
            else:
                t.say("I can't see any upcoming bookings under this number.", node.id)
            return self._go(state, node, "success")
        # cancel_appointment: the next booking, read back, needs a clear yes.
        if not rows:
            t.say("I can't see any upcoming bookings under this number.", node.id)
            return self._go(state, node, "failure")
        a = rows[0]
        state["sub"] = {"cancel": str(a.id)}
        t.say(
            f"Is it the {a.service_name} on {reception.spoken_time(a.starts_at.astimezone(self.rt.desk.tz))} "
            "you'd like to cancel?",
            node.id,
        )
        state["waiting"] = True

    def _tool_reply(self, state: dict, t: Turn, node: Node, s: ToolSettings, text: str) -> None:
        appt_id = state["sub"].get("cancel")
        state["sub"] = {}
        if not appt_id or not affirmed(text):
            t.say("Okay, I've left it as it is.", node.id)
            return self._go(state, node, "failure")
        a = self.rt.db.scalar(
            select(Appointment).where(
                Appointment.id == uuid.UUID(appt_id), Appointment.organization_id == self.rt.org_id
            )
        )
        if a is None or a.status != AppointmentStatus.booked:
            return self._go(state, node, "failure")
        with self._effects():
            reception.cancel(self.rt.db, a)
        t.tool(
            "cancel_appointment",
            node.id,
            True,
            {"ref": appt_id[:8]},
            "cancelled" if not self.rt.dry else "valid (simulation: not saved)",
            0,
            not self.rt.dry,
        )
        t.say("That's cancelled for you.", node.id)
        state["outcome"] = "cancelled"
        return self._go(state, node, "success")

    def _finish(self, state: dict, t: Turn, outcome: str, message: str | None) -> None:
        if message:
            t.say(message, state.get("node") or "end")
        state.update(ended=True, waiting=False, outcome=state.get("outcome") or outcome)
        t.events.append({"type": "end", "outcome": state["outcome"]})


assert set(INTENTS) >= {"book", "human"}
