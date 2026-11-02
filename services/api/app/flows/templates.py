"""The starting flow for a new agent: a complete, publishable receptionist that owners can edit."""

from .schema import Flow


def _n(id_: str, type_: str, label: str, x: float, y: float, **settings) -> dict:
    return {"id": id_, "type": type_, "label": label, "position": {"x": x, "y": y}, "settings": settings}


def _e(src: str, outcome: str, dst: str) -> dict:
    return {"id": f"{src}--{outcome}", "source": src, "outcome": outcome, "target": dst}


def default_flow(greeting: str | None = None) -> Flow:
    start = {"greeting": greeting} if greeting else {}
    nodes = [
        _n("start", "start", "Greeting", 0, 0, **start),
        _n("hours", "hours_check", "Are we open?", 0, 140),
        _n(
            "route",
            "condition",
            "What do they want?",
            0,
            300,
            rules=[
                {"id": "book", "variable": "intent", "op": "equals", "value": "book", "label": "Book"},
                {"id": "human", "variable": "intent", "op": "equals", "value": "human", "label": "A person"},
                {
                    "id": "change",
                    "variable": "intent",
                    "op": "in",
                    "value": "reschedule,cancel",
                    "label": "Change a booking",
                },
            ],
        ),
        _n("svc", "service_lookup", "Which service?", -420, 470),
        _n(
            "ask-svc",
            "ask",
            "Ask for the service",
            -700,
            620,
            question="Which service would you like to book?",
            variable="service_text",
            kind="service",
        ),
        _n("svc2", "service_lookup", "Match their answer", -700, 780, from_variable="service_text"),
        _n("slots", "availability", "Find free times", -420, 780),
        _n("book", "booking", "Book it", -420, 940),
        _n("booked", "end", "Booked", -420, 1100, message="You're all booked. Thanks for calling, goodbye!"),
        _n("transfer", "transfer", "Put through to the team", 0, 470),
        _n("msg", "escalate", "Take a message", 260, 640, reason="caller needs the team"),
        _n("change", "escalate", "Change a booking", 260, 470, reason="wants to change or cancel a booking"),
        _n("kb", "knowledge", "Answer from our details", 560, 470),
        _n(
            "more",
            "ask",
            "Anything else?",
            560,
            640,
            question="Is there anything else I can help with?",
            variable="anything_else",
            kind="text",
        ),
        _n(
            "closed",
            "respond",
            "We're closed",
            420,
            140,
            message="We're closed right now, but I can take a message and the team will call you back.",
        ),
        _n("bye", "end", "Goodbye", 560, 960, message="Thanks for calling. Goodbye!"),
        _n(
            "done",
            "condition",
            "Finished?",
            560,
            800,
            rules=[{"id": "done", "variable": "anything_else", "op": "is_no", "label": "Nothing else"}],
        ),
    ]
    edges = [
        _e("start", "next", "hours"),
        _e("hours", "open", "route"),
        _e("hours", "closed", "closed"),
        _e("closed", "next", "msg"),
        _e("route", "book", "svc"),
        _e("route", "human", "transfer"),
        _e("route", "change", "change"),
        _e("route", "else", "kb"),
        _e("svc", "found", "slots"),
        _e("svc", "ambiguous", "ask-svc"),
        _e("svc", "not_found", "ask-svc"),
        _e("ask-svc", "answered", "svc2"),
        _e("ask-svc", "no_answer", "msg"),
        _e("svc2", "found", "slots"),
        _e("svc2", "ambiguous", "msg"),
        _e("svc2", "not_found", "msg"),
        _e("slots", "available", "book"),
        _e("slots", "none", "msg"),
        _e("book", "booked", "booked"),
        _e("book", "declined", "more"),
        _e("book", "failed", "msg"),
        _e("transfer", "transferred", "bye"),
        _e("transfer", "unavailable", "msg"),
        _e("msg", "handed_off", "bye"),
        _e("change", "handed_off", "bye"),
        _e("kb", "answered", "more"),
        _e("kb", "not_found", "msg"),
        _e("more", "answered", "done"),
        _e("done", "done", "bye"),
        _e("done", "else", "route"),
        _e("more", "no_answer", "bye"),
    ]
    return Flow.model_validate({"nodes": nodes, "edges": edges})
