"""Checks a flow before it can be published. Drafts may be saved with problems; publishing
needs zero errors. Warnings are shown but don't block."""

from collections import deque
from dataclasses import asdict, dataclass

from pydantic import ValidationError

from .schema import BUILTIN_VARS, NODE_SETTINGS, TERMINAL, AskSettings, CollectSettings, Flow, Node, outcomes


@dataclass
class Issue:
    severity: str  # "error" | "warning"
    code: str
    message: str
    node_id: str | None = None
    edge_id: str | None = None


@dataclass
class Report:
    issues: list[Issue]

    @property
    def ok(self) -> bool:
        return not any(i.severity == "error" for i in self.issues)

    def as_dict(self) -> dict:
        return {
            "ok": self.ok,
            "errors": sum(i.severity == "error" for i in self.issues),
            "warnings": sum(i.severity == "warning" for i in self.issues),
            "issues": [asdict(i) for i in self.issues],
        }


def _err(code: str, msg: str, node: str | None = None, edge: str | None = None) -> Issue:
    return Issue("error", code, msg, node, edge)


def _warn(code: str, msg: str, node: str | None = None, edge: str | None = None) -> Issue:
    return Issue("warning", code, msg, node, edge)


def _name(n: Node) -> str:
    return f"“{n.label or n.id}”"


def validate(flow: Flow) -> Report:
    issues: list[Issue] = []
    nodes = {}
    for n in flow.nodes:
        if n.id in nodes:
            issues.append(_err("duplicate_node", f"Two nodes share the id {n.id}.", n.id))
        nodes[n.id] = n

    # Settings for each node type.
    settings = {}
    for n in flow.nodes:
        try:
            settings[n.id] = NODE_SETTINGS[n.type].model_validate(n.settings)
        except ValidationError as e:
            for x in e.errors()[:3]:
                where = ".".join(str(p) for p in x["loc"]) or "settings"
                issues.append(_err("invalid_settings", f"{_name(n)}: {where} — {x['msg']}", n.id))

    starts = [n for n in flow.nodes if n.type == "start"]
    if len(starts) != 1:
        issues.append(_err("start_count", f"A flow needs exactly one Start node (found {len(starts)})."))

    # Edges: real nodes, real outcomes, one edge per outcome, nothing out of End.
    out: dict[str, dict[str, str]] = {nid: {} for nid in nodes}
    seen_edges = set()
    for e in flow.edges:
        if e.id in seen_edges:
            issues.append(_err("duplicate_edge", f"Two connections share the id {e.id}.", edge=e.id))
        seen_edges.add(e.id)
        src, dst = nodes.get(e.source), nodes.get(e.target)
        if src is None or dst is None:
            issues.append(_err("dangling_edge", "A connection points to a node that no longer exists.", edge=e.id))
            continue
        if dst.type == "start":
            issues.append(_err("into_start", "Nothing can connect back into the Start node.", dst.id, e.id))
        valid = outcomes(src, settings.get(src.id))
        if e.outcome not in valid:
            issues.append(
                _err(
                    "unknown_outcome",
                    f"{_name(src)} has no outcome “{e.outcome}” (it has {', '.join(valid) or 'none'}).",
                    src.id,
                    e.id,
                )
            )
            continue
        if e.outcome in out[src.id]:
            issues.append(_err("double_outcome", f"{_name(src)}: “{e.outcome}” is connected twice.", src.id, e.id))
        out[src.id][e.outcome] = dst.id

    # Every outcome of every node must lead somewhere (End has none).
    for n in flow.nodes:
        for o in outcomes(n, settings.get(n.id)):
            if o not in out.get(n.id, {}):
                issues.append(_err("open_outcome", f"{_name(n)}: what happens when “{o}”? Connect it.", n.id))

    if len(starts) == 1:
        start = starts[0].id
        reach = _reachable(start, out)
        for n in flow.nodes:
            if n.id not in reach:
                issues.append(_warn("unreachable", f"{_name(n)} can never be reached from Start.", n.id))
        # Every reachable node must be able to finish the call (no traps).
        finishing = {nid for nid, n in nodes.items() if n.type in TERMINAL}
        can_finish = _reverse_reachable(finishing, out)
        for nid in reach:
            if nid not in can_finish:
                issues.append(
                    _err("no_way_out", f"{_name(nodes[nid])} can't reach an End, Escalate or Transfer node.", nid)
                )
        # A booking may only happen after availability was checked on EVERY path to it.
        avail = {nid for nid, n in nodes.items() if n.type == "availability"}
        sneaky = _reachable(start, out, blocked=avail)
        for nid, n in nodes.items():
            if n.type == "booking" and nid in sneaky:
                issues.append(
                    _err(
                        "booking_without_availability",
                        f"{_name(n)} can be reached without an Availability check first. "
                        "Bookings must only offer times the diary has free.",
                        nid,
                    )
                )
        # Variables used by conditions should be collected somewhere upstream (or built in).
        defined = set(BUILTIN_VARS)
        for nid in reach:
            s = settings.get(nid)
            if isinstance(s, AskSettings):
                defined.add(s.variable)
            if isinstance(s, CollectSettings):
                defined |= {f"customer_{f}" if f in ("name", "phone") else f for f in s.fields}
        for n in flow.nodes:
            s = settings.get(n.id)
            for r in getattr(s, "rules", []) or []:
                if r.variable not in defined:
                    issues.append(
                        _warn(
                            "unknown_variable",
                            f"{_name(n)} checks “{r.variable}”, which no Ask node collects.",
                            n.id,
                        )
                    )
    if not any(n.type == "end" for n in flow.nodes):
        issues.append(_err("no_end", "Add at least one End node."))
    return Report(issues)


def _reachable(start: str, out: dict[str, dict[str, str]], blocked: set[str] | None = None) -> set[str]:
    blocked = blocked or set()
    seen, q = {start}, deque([start])
    while q:
        cur = q.popleft()
        if cur in blocked:
            continue
        for nxt in out.get(cur, {}).values():
            if nxt not in seen:
                seen.add(nxt)
                q.append(nxt)
    return seen


def _reverse_reachable(targets: set[str], out: dict[str, dict[str, str]]) -> set[str]:
    back: dict[str, set[str]] = {}
    for src, outs in out.items():
        for dst in outs.values():
            back.setdefault(dst, set()).add(src)
    seen, q = set(targets), deque(targets)
    while q:
        cur = q.popleft()
        for prev in back.get(cur, ()):
            if prev not in seen:
                seen.add(prev)
                q.append(prev)
    return seen
