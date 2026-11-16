"""Plain-English flow editing: an owner's instruction becomes a proposed change to the draft.

Nothing is saved here. A proposal carries the whole new graph, a readable before → after list,
how much it matters (impact) and whether it must be confirmed, plus the new graph's validation.
The Studio shows it; only the owner's confirmation saves it (as an ordinary draft save, so undo
and version rollback work as usual). Instructions that aren't understood are said to be, with
examples, rather than guessed at. Only the flow is changed, never business settings.
"""

import copy
import re
from dataclasses import dataclass, field

from .schema import Flow
from .validate import validate

DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
EXAMPLES = [
    "When someone calls after 6 PM, offer to take a message.",
    "If the customer wants a haircut, ask which barber they prefer.",
    "If the caller asks for the manager, transfer to available management staff.",
    "Don't accept appointments on Sundays.",
    "If someone asks about parking, say there's free parking behind the shop.",
    "Change the greeting to: Hi, you're through to EW Saloon. I'm Ray, the AI receptionist.",
]


class NotUnderstood(ValueError):
    pass


@dataclass
class Proposal:
    summary: str
    impact: str  # "normal" | "high"
    graph: dict
    notes: list[str] = field(default_factory=list)

    def as_dict(self, before: dict) -> dict:
        flow = Flow.model_validate(self.graph)
        return {
            "summary": self.summary,
            "impact": self.impact,
            "requires_confirmation": True,
            "changes": diff(before, self.graph),
            "notes": self.notes,
            "graph": flow.model_dump(mode="json"),
            "validation": validate(flow).as_dict(),
        }


def _uid(g: dict, base: str) -> str:
    ids = {n["id"] for n in g["nodes"]}
    i, cand = 1, base
    while cand in ids:
        i += 1
        cand = f"{base}-{i}"
    return cand


def _node(g: dict, base: str, type_: str, label: str, x: float, y: float, **settings) -> str:
    nid = _uid(g, base)
    g["nodes"].append({"id": nid, "type": type_, "label": label, "position": {"x": x, "y": y}, "settings": settings})
    return nid


def _edge(g: dict, src: str, outcome: str, dst: str) -> None:
    g["edges"] = [e for e in g["edges"] if not (e["source"] == src and e["outcome"] == outcome)]
    eid = _uid({"nodes": [{"id": e["id"]} for e in g["edges"]]}, f"{src}--{outcome}")
    g["edges"].append({"id": eid, "source": src, "outcome": outcome, "target": dst})


def _first(g: dict, type_: str) -> dict | None:
    return next((n for n in g["nodes"] if n["type"] == type_), None)


def _pos(n: dict, dx: float = 0, dy: float = 0) -> tuple[float, float]:
    p = n.get("position") or {"x": 0, "y": 0}
    return p["x"] + dx, p["y"] + dy


def _message_target(g: dict) -> str:
    """Where 'take a message' goes: the first escalate node (added if the flow has none)."""
    esc = _first(g, "escalate")
    if esc:
        return esc["id"]
    end = _first(g, "end")
    nid = _node(g, "msg", "escalate", "Take a message", *(_pos(end, 0, -150) if end else (0, 0)), reason="message")
    if end:
        _edge(g, nid, "handed_off", end["id"])
    return nid


def _parse_time(s: str) -> str | None:
    m = re.search(r"\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?", s, re.I)
    if not m:
        return None
    h, mi = int(m.group(1)), int(m.group(2) or 0)
    ampm = (m.group(3) or "").lower().replace(".", "")
    if ampm == "pm" and h < 12:
        h += 12
    if not ampm and h < 8:  # "after 6" means the evening
        h += 12
    return f"{h:02d}:{mi:02d}" if h < 24 and mi < 60 else None


def interpret(text: str, before: dict) -> Proposal:
    t = " ".join(text.strip().split())
    low = t.lower()
    g = copy.deepcopy(before)
    start = _first(g, "start")

    # Change the greeting to: ...
    m = re.match(r"^(?:change|set|update) (?:the )?greeting to:?\s*(.+)$", t, re.I)
    if m and start:
        start.setdefault("settings", {})["greeting"] = m.group(1).strip().strip('"“”')
        return Proposal("Change what callers hear first", "high", g, ["Callers will hear this on every call."])

    # After/before a time → take a message (or say something)
    m = re.search(r"\b(after|before)\s+(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)", low)
    if m and re.search(r"\b(message|call(?:s|ed)? back|callback)\b", low) and start:
        hhmm = _parse_time(m.group(2))
        if not hhmm:
            raise NotUnderstood("I couldn't read the time.")
        op = "time_after" if m.group(1) == "after" else "time_before"
        nxt = next((e for e in g["edges"] if e["source"] == start["id"] and e["outcome"] == "next"), None)
        if nxt is None:
            raise NotUnderstood("The Start node isn't connected yet.")
        x, y = _pos(start, 320, 90)
        cond = _node(
            g,
            "late",
            "condition",
            f"{m.group(1).capitalize()} {hhmm}?",
            x,
            y,
            rules=[{"id": "late", "variable": "now_local", "op": op, "value": hhmm, "label": f"{m.group(1)} {hhmm}"}],
        )
        say = _node(
            g,
            "late-msg",
            "respond",
            "Offer a message",
            x + 300,
            y + 120,
            message="We're winding down for the day, but I can take a message and the team will call you back.",
        )
        _edge(g, start["id"], "next", cond)
        _edge(g, cond, "late", say)
        _edge(g, cond, "else", nxt["target"])
        _edge(g, say, "next", _message_target(g))
        when = "after" if op == "time_after" else "before"
        return Proposal(f"Calls {when} {hhmm} are offered a message instead of the usual call", "high", g)

    # Don't accept appointments on <day>s
    m = re.search(r"\b(?:don'?t|do not|never|no)\b.*\b(appointments?|bookings?|book)\b.*\bon\s+(\w+?)s?\b", low)
    if m:
        day = next((i for i, d in enumerate(DAYS) if m.group(2).startswith(d[:3])), None)
        avail = [n for n in g["nodes"] if n["type"] == "availability"]
        if day is None or not avail:
            raise NotUnderstood("I couldn't tell which day, or the flow has no availability step.")
        for n in avail:
            ex = sorted({*n.setdefault("settings", {}).get("exclude_weekdays", []), day})
            n["settings"]["exclude_weekdays"] = ex
        return Proposal(
            f"No appointments will be offered on {DAYS[day].capitalize()}s",
            "high",
            g,
            ["This only changes what the receptionist offers. Your opening hours stay as they are."],
        )

    # Caller asks for the manager → management staff
    if re.search(r"\b(manager|management|owner)\b", low) and re.search(
        r"\b(transfer|put (them )?through|connect)\b", low
    ):
        existing = next(
            (n for n in g["nodes"] if n["type"] == "transfer" and n.get("settings", {}).get("target") == "managers"),
            None,
        )
        if existing:
            raise NotUnderstood("Callers asking for a manager already go to management staff.")
        anchor = _first(g, "transfer") or start
        x, y = _pos(anchor, 0, 170)
        node = _node(
            g,
            "managers",
            "transfer",
            "Put through to a manager",
            x,
            y,
            target="managers",
            message="Of course, let me get a manager for you.",
        )
        end = _first(g, "end")
        if end is None:
            raise NotUnderstood("The flow needs an End node first.")
        _edge(g, node, "transferred", end["id"])
        _edge(g, node, "unavailable", _message_target(g))
        route = next(
            (
                n
                for n in g["nodes"]
                if n["type"] == "condition"
                and any(r.get("variable") == "intent" for r in n.get("settings", {}).get("rules", []))
            ),
            None,
        )
        if route:  # make it reachable from the main routing step too
            rules = route["settings"]["rules"]
            if not any(r["id"] == "manager" for r in rules):
                rules.insert(
                    0,
                    {
                        "id": "manager",
                        "variable": "last_message",
                        "op": "contains",
                        "value": "manager",
                        "label": "Asks for the manager",
                    },
                )
                _edge(g, route["id"], "manager", node)
        return Proposal(
            "Callers who ask for the manager go to available management staff",
            "normal",
            g,
            ["Managers, admins and the owner must be marked Available on the Desk to take these calls."],
        )

    # If the customer wants X, ask Q
    m = re.search(
        r"\bif (?:the )?(?:customer|caller|someone|they)\s+wants?\s+(?:a |an |some )?([\w\s'-]+?),?\s+"
        r"ask(?: them)?\s+(.+?)[.?!]*$",
        low,
    )
    if m:
        what, question = m.group(1).strip(), m.group(2).strip()
        q = question[0].upper() + question[1:]
        if not q.endswith("?"):
            q = re.sub(r"^(?:which|what|who|whether|if)\b", lambda mm: mm.group(0).capitalize(), q) + "?"
        avail = _first(g, "availability")
        if not avail:
            raise NotUnderstood("The flow has no availability step to ask this before.")
        incoming = [e for e in g["edges"] if e["target"] == avail["id"]]
        x, y = _pos(avail, -320, -60)
        var = re.sub(r"[^a-z0-9]+", "_", "preferred " + re.sub(r"^(which|what|who)\s+", "", question.lower()))[
            :38
        ].strip("_")
        var = var if re.match(r"^[a-z]", var) else "preference"
        cond = _node(
            g,
            "if-" + re.sub(r"[^a-z0-9]+", "-", what)[:20].strip("-"),
            "condition",
            f"Wants {what}?",
            x,
            y,
            rules=[{"id": "yes", "variable": "service", "op": "contains", "value": what.rstrip("s"), "label": what}],
        )
        ask = _node(g, "ask-pref", "ask", q, x - 40, y + 140, question=q, variable=var, kind="text")
        for e in incoming:
            e["target"] = cond
        _edge(g, cond, "yes", ask)
        _edge(g, cond, "else", avail["id"])
        _edge(g, ask, "answered", avail["id"])
        _edge(g, ask, "no_answer", avail["id"])
        return Proposal(
            f"Before finding times for {what}, the receptionist asks: “{q}”",
            "normal",
            g,
            [f"The answer is saved as “{var}” and passed to the team with the booking."],
        )

    # If someone asks about X, say Y
    m = re.search(
        r"\bif (?:someone|a caller|the caller|they|anyone)\s+asks?\s+(?:about|for)\s+(.+?),\s*"
        r"(?:say|tell them)\s+(?:that\s+)?(.+?)$",
        t,
        re.I,
    )
    if m:
        topic, answer = m.group(1).strip().rstrip("."), m.group(2).strip().rstrip(".") + "."
        answer = answer[0].upper() + answer[1:]
        route = next(
            (
                n
                for n in g["nodes"]
                if n["type"] == "condition"
                and any(r.get("variable") == "intent" for r in n.get("settings", {}).get("rules", []))
            ),
            None,
        )
        if route is None:
            raise NotUnderstood("I couldn't find the step that routes callers by what they want.")
        rid = re.sub(r"[^a-z0-9]+", "-", topic.lower())[:30].strip("-") or "topic"
        if any(r["id"] == rid for r in route["settings"]["rules"]):
            raise NotUnderstood(f"There's already a rule for “{topic}”.")
        key = topic.split()[-1].lower()
        route["settings"]["rules"].insert(
            0, {"id": rid, "variable": "last_message", "op": "contains", "value": key, "label": f"Asks about {topic}"}
        )
        x, y = _pos(route, 700, 0)
        say = _node(g, f"say-{rid}", "respond", f"About {topic}", x, y, message=answer)
        after = next(
            (n for n in g["nodes"] if n["type"] == "ask" and n.get("settings", {}).get("variable") == "anything_else"),
            None,
        )
        _edge(g, route["id"], rid, say)
        _edge(g, say, "next", after["id"] if after else (_first(g, "end") or {"id": route["id"]})["id"])
        return Proposal(f"Questions mentioning “{key}” get your answer: “{answer}”", "normal", g)

    raise NotUnderstood("I couldn't turn that into a change to the flow.")


def _label(n: dict) -> str:
    return f"“{n.get('label') or n['id']}”"


def diff(before: dict, after: dict) -> list[dict]:
    """A readable list of what changed between two flows."""
    out: list[dict] = []
    bn = {n["id"]: n for n in before.get("nodes", [])}
    an = {n["id"]: n for n in after.get("nodes", [])}
    for nid, n in an.items():
        if nid not in bn:
            out.append(
                {"kind": "added_node", "node": nid, "text": f"New step {_label(n)} ({n['type'].replace('_', ' ')})"}
            )
    for nid, n in bn.items():
        if nid not in an:
            out.append({"kind": "removed_node", "node": nid, "text": f"Removed step {_label(n)}"})
    for nid in bn.keys() & an.keys():
        b, a = bn[nid].get("settings", {}), an[nid].get("settings", {})
        for k in sorted(set(b) | set(a)):
            if b.get(k) != a.get(k):
                out.append(
                    {
                        "kind": "changed_setting",
                        "node": nid,
                        "text": f"{_label(an[nid])}: {k.replace('_', ' ')}",
                        "before": b.get(k),
                        "after": a.get(k),
                    }
                )
        if bn[nid].get("label") != an[nid].get("label"):
            out.append({"kind": "renamed", "node": nid, "text": f"Renamed {_label(bn[nid])} to {_label(an[nid])}"})
    be = {(e["source"], e["outcome"]): e["target"] for e in before.get("edges", [])}
    ae = {(e["source"], e["outcome"]): e["target"] for e in after.get("edges", [])}
    names = {**{k: v.get("label") or k for k, v in bn.items()}, **{k: v.get("label") or k for k, v in an.items()}}
    for key in sorted(set(be) | set(ae)):
        if be.get(key) != ae.get(key):
            src, outcome = key
            text = f"“{names.get(src, src)}” · {outcome}: " + (
                f"{names.get(be[key], be[key])} → {names.get(ae[key], ae[key])}"
                if key in be and key in ae
                else f"now goes to {names.get(ae[key], ae[key])}"
                if key in ae
                else "connection removed"
            )
            out.append({"kind": "connection", "node": src, "text": text})
    return out
