"""The conversation-flow document: nodes, their settings and outcomes, and the edges between them.

A flow is plain JSON, stored per agent as a mutable draft and as immutable published versions.
Every node type declares the outcomes it can end with; an edge connects one outcome of one
node to another node. The engine (app/flows/engine.py) runs a published flow; business-critical
nodes (availability, booking, transfer) call the same deterministic code as the REST API.
"""

import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

AI_DISCLOSURE = re.compile(r"\b(AI|A\.I\.|artificial intelligence|virtual (assistant|receptionist)|automated)\b", re.I)
Id = Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9_-]{0,39}$")]
Var = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,39}$")]
Text = Annotated[str, StringConstraints(strip_whitespace=True, max_length=600)]
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)]

# Variables the engine always provides.
BUILTIN_VARS = {
    "intent",  # book | reschedule | cancel | question | human | other
    "caller_phone",
    "last_message",
    "now_local",
    "service",  # set by service_lookup
    "slot",  # set by availability (the time the caller chose)
    "booking_ref",
    "customer_name",
    "customer_phone",
}
INTENTS = ["book", "reschedule", "cancel", "question", "human", "other"]


class S(BaseModel):
    model_config = ConfigDict(extra="forbid")


class StartSettings(S):
    greeting: Text = "Hi, thanks for calling {business}. I'm {agent}, the AI receptionist. How can I help?"

    @field_validator("greeting")
    @classmethod
    def discloses_ai(cls, v: str) -> str:
        if not AI_DISCLOSURE.search(v):
            raise ValueError("the greeting must tell callers they are speaking to an AI")
        return v


class AskSettings(S):
    question: Text
    variable: Var
    kind: Literal["text", "name", "phone", "date", "time", "service", "yes_no", "choice"] = "text"
    choices: list[ShortText] = Field(default_factory=list, max_length=12)
    retries: int = Field(1, ge=0, le=3)


class RespondSettings(S):
    message: Text
    mode: Literal["fixed", "ai"] = "fixed"  # "ai" lets the model phrase it, facts still from tools only


class KnowledgeSettings(S):
    topics: list[Literal["services", "prices", "hours", "address", "phone", "description", "policies"]] = Field(
        default_factory=lambda: ["services", "prices", "hours", "address", "phone", "description"], min_length=1
    )


class Rule(S):
    id: Id
    variable: Var
    op: Literal[
        "equals", "not_equals", "contains", "is_set", "is_not_set", "in", "is_yes", "is_no", "time_after", "time_before"
    ]
    value: ShortText = ""
    label: ShortText = ""


class ConditionSettings(S):
    rules: list[Rule] = Field(min_length=1, max_length=12)

    @field_validator("rules")
    @classmethod
    def unique_ids(cls, v: list[Rule]) -> list[Rule]:
        ids = [r.id for r in v]
        if len(ids) != len(set(ids)) or "else" in ids:
            raise ValueError("rule ids must be unique and must not be 'else'")
        return v


class HoursSettings(S):
    pass


class ServiceLookupSettings(S):
    from_variable: Var = "last_message"


class AvailabilitySettings(S):
    part_of_day: Literal["any", "morning", "afternoon", "evening", "from_caller"] = "from_caller"
    offer: int = Field(3, ge=1, le=5)
    exclude_weekdays: list[int] = Field(default_factory=list, max_length=7)  # 0 = Monday … 6 = Sunday

    @field_validator("exclude_weekdays")
    @classmethod
    def weekdays(cls, v: list[int]) -> list[int]:
        if any(not 0 <= d <= 6 for d in v):
            raise ValueError("weekdays are 0 (Monday) to 6 (Sunday)")
        return sorted(set(v))


class BookingSettings(S):
    # Always read back and require a clear yes; the setting exists so the rule is visible, not to turn it off.
    confirm: Literal[True] = True


class CollectSettings(S):
    fields: list[Literal["name", "phone", "email", "notes"]] = Field(min_length=1, max_length=4)


class ToolSettings(S):
    tool: Literal["take_message", "find_my_appointments", "cancel_appointment", "reschedule_appointment"]


class EscalateSettings(S):
    reason: ShortText = "needs the team"
    urgent: bool = False


class TransferSettings(S):
    target: Literal["any_available", "managers"] = "any_available"
    message: Text = "Of course, I'll put you through to the team now."


class EndSettings(S):
    message: Text = "Thanks for calling. Goodbye!"


NODE_SETTINGS: dict[str, type[S]] = {
    "start": StartSettings,
    "ask": AskSettings,
    "respond": RespondSettings,
    "knowledge": KnowledgeSettings,
    "condition": ConditionSettings,
    "hours_check": HoursSettings,
    "service_lookup": ServiceLookupSettings,
    "availability": AvailabilitySettings,
    "booking": BookingSettings,
    "collect_info": CollectSettings,
    "tool": ToolSettings,
    "escalate": EscalateSettings,
    "transfer": TransferSettings,
    "end": EndSettings,
}
NodeType = Literal[
    "start",
    "ask",
    "respond",
    "knowledge",
    "condition",
    "hours_check",
    "service_lookup",
    "availability",
    "booking",
    "collect_info",
    "tool",
    "escalate",
    "transfer",
    "end",
]
STATIC_OUTCOMES: dict[str, list[str]] = {
    "start": ["next"],
    "ask": ["answered", "no_answer"],
    "respond": ["next"],
    "knowledge": ["answered", "not_found"],
    "hours_check": ["open", "closed"],
    "service_lookup": ["found", "ambiguous", "not_found"],
    "availability": ["available", "none"],
    "booking": ["booked", "declined", "failed"],
    "collect_info": ["collected", "incomplete"],
    "tool": ["success", "failure"],
    "escalate": ["handed_off"],
    "transfer": ["transferred", "unavailable"],
    "end": [],
}
# Nodes after which the call is with a person (or over): a path may stop here.
TERMINAL = {"end", "escalate", "transfer"}


class Position(S):
    x: float = Field(ge=-100_000, le=100_000)
    y: float = Field(ge=-100_000, le=100_000)


class Node(S):
    id: Id
    type: NodeType
    label: ShortText = ""
    position: Position = Position(x=0, y=0)
    settings: dict = Field(default_factory=dict)


class Edge(S):
    id: Id
    source: Id
    outcome: Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9_-]{0,39}$")]
    target: Id


class FlowSettings(S):
    persona: Text = "Warm, calm and brief. Plain English. One question at a time."
    max_turns: int = Field(30, ge=4, le=80)


class Flow(S):
    schema_version: Literal[1] = 1
    settings: FlowSettings = FlowSettings()
    nodes: list[Node] = Field(max_length=200)
    edges: list[Edge] = Field(default_factory=list, max_length=400)


def outcomes(node: Node, settings: S | None = None) -> list[str]:
    """The outcomes a node can end with (a condition has one per rule, plus else)."""
    if node.type == "condition":
        rules = settings.rules if isinstance(settings, ConditionSettings) else node.settings.get("rules") or []
        ids = [r.id if isinstance(r, Rule) else str(r.get("id", "")) for r in rules]
        return [*ids, "else"]
    return STATIC_OUTCOMES[node.type]
