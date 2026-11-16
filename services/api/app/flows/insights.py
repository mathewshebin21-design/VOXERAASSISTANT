"""Call intelligence over flow sessions: outcomes, conversions, escalations, tool failures,
knowledge gaps, common questions, trends, latency and cost.

Every number is computed from stored transcripts, nothing is estimated or invented, and every
report says which kind of data it covers (simulated, test or real calls). Summaries link each
statement to the transcript event it came from.
"""

import re
from collections import Counter, defaultdict
from statistics import mean


def _norm(q: str) -> str:
    q = re.sub(r"[^a-z0-9£ ]+", " ", q.lower())
    q = re.sub(r"\b(hi|hello|hey|please|thanks|thank you|um|uh|so|okay|ok)\b", " ", q)
    return " ".join(q.split())[:80]


def summarise(transcript: list[dict]) -> list[dict]:
    """An evidence-linked summary: each line points at the transcript event(s) it is based on."""
    lines: list[dict] = []
    for i, e in enumerate(transcript):
        if e["type"] == "caller" and not any(x["kind"] == "asked" for x in lines):
            lines.append({"kind": "asked", "text": f"Caller said: “{e['text'][:120]}”", "events": [i]})
        elif e["type"] == "tool":
            verb = "succeeded" if e["ok"] else "failed"
            lines.append(
                {"kind": "tool", "text": f"{e['name'].replace('_', ' ')} {verb}: {e['result'][:120]}", "events": [i]}
            )
        elif e["type"] == "evidence" and e["source"] != "opening_hours":
            lines.append({"kind": "answer", "text": f"Answered from {e['source']}: {e['value'][:120]}", "events": [i]})
        elif e["type"] == "guardrail" and e["rule"] in ("unsupported_answer", "instruction_override", "urgent_safety"):
            lines.append({"kind": "guardrail", "text": e["text"], "events": [i]})
        elif e["type"] == "end":
            lines.append({"kind": "outcome", "text": f"Outcome: {e['outcome'].replace('_', ' ')}", "events": [i]})
    return lines


def report(sessions: list, mode: str) -> dict:
    """Aggregates for one kind of data. `sessions` are FlowSession rows of that mode."""
    outcomes: Counter = Counter()
    by_day: dict[str, Counter] = defaultdict(Counter)
    tool_failures: Counter = Counter()
    gaps: Counter = Counter()
    questions: Counter = Counter()
    latencies: list[float] = []
    turns: list[int] = []
    wanted_booking = booked = escalations = transfers = 0
    for s in sessions:
        tr = s.transcript or []
        outcome = s.outcome or ("in_progress" if not s.ended else "completed")
        outcomes[outcome] += 1
        by_day[s.created_at.date().isoformat()][outcome] += 1
        callers = [e["text"] for e in tr if e["type"] == "caller"]
        turns.append(len(callers))
        if any(re.search(r"\b(book|appointment|slot|available)\b", c, re.I) for c in callers):
            wanted_booking += 1
            booked += outcome == "booked"
        for i, e in enumerate(tr):
            if e["type"] == "tool":
                latencies.append(e.get("latency_ms", 0))
                if not e["ok"]:
                    tool_failures[e["name"]] += 1
                if e["name"] == "escalate" and e["ok"]:
                    escalations += 1
                if e["name"] == "transfer" and e["ok"]:
                    transfers += 1
            if e["type"] == "guardrail" and e["rule"] == "unsupported_answer":
                prev = next((x["text"] for x in reversed(tr[:i]) if x["type"] == "caller"), "")
                if prev:
                    gaps[_norm(prev)] += 1
        for c in callers:
            if "?" in c or re.match(r"^\W*(what|how|when|where|which|who|do you|are you|is there|can you)", c, re.I):
                questions[_norm(c)] += 1
    n = len(sessions)
    return {
        "data": mode,
        "label": {
            "simulation": "Simulated conversations (not real callers)",
            "test": "Automated test runs (not real callers)",
            "live": "Real calls",
        }.get(mode, mode),
        "conversations": n,
        "outcomes": dict(outcomes),
        "resolved": sum(v for k, v in outcomes.items() if k in ("booked", "completed", "cancelled")),
        "booking_conversion": {
            "wanted": wanted_booking,
            "booked": booked,
            "rate": round(booked / wanted_booking, 3) if wanted_booking else None,
        },
        "escalations": escalations,
        "transfers": transfers,
        "failed_tool_calls": dict(tool_failures),
        "knowledge_gaps": [{"question": q, "count": c} for q, c in gaps.most_common(10)],
        "common_questions": [{"question": q, "count": c} for q, c in questions.most_common(10)],
        "average_turns": round(mean(turns), 2) if turns else None,
        "tool_latency_ms": {
            "average": round(mean(latencies), 1) if latencies else None,
            "max": round(max(latencies), 1) if latencies else None,
            "note": "Time spent in VOXERA's own tools. No speech or phone-line latency is included.",
        },
        "model": {
            "tokens": 0,
            "estimated_cost_gbp": 0.0,
            "note": "These conversations ran on the deterministic engine; no language model was called.",
        },
        "trend": [{"day": d, **dict(c)} for d, c in sorted(by_day.items())],
    }
