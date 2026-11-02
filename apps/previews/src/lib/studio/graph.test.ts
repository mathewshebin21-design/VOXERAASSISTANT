import { describe, expect, it } from "vitest";
import { addNode, commit, connect, disconnect, history, openOutcomes, outcomesOf, redo, removeNode, uid, undo, updateNode, type FlowDoc } from "./graph";

const base = (): FlowDoc => ({
  schema_version: 1,
  settings: { persona: "", max_turns: 30 },
  nodes: [
    { id: "start", type: "start", label: "Greeting", position: { x: 0, y: 0 }, settings: {} },
    { id: "route", type: "condition", label: "Route", position: { x: 0, y: 100 }, settings: { rules: [{ id: "book", variable: "intent", op: "equals", value: "book", label: "" }] } },
    { id: "bye", type: "end", label: "Bye", position: { x: 0, y: 200 }, settings: {} },
  ],
  edges: [],
});

describe("studio graph", () => {
  it("adds nodes with unique ids and defaults", () => {
    const a = addNode(base(), "ask", { x: 1, y: 2 });
    const b = addNode(a.flow, "ask", { x: 3, y: 4 });
    expect(a.id).toBe("ask");
    expect(b.id).toBe("ask-2");
    expect(b.flow.nodes.at(-1)!.settings).toMatchObject({ kind: "text", retries: 1 });
    expect(uid(["x", "x-2"], "x")).toBe("x-3");
  });

  it("validates connections: real outcomes, nothing into Start, no self-loops, one edge per outcome", () => {
    const f = base();
    expect(connect(f, "route", "maybe", "bye")).toEqual({ ok: false, reason: "“Route” has no “maybe” outcome." });
    expect(connect(f, "route", "book", "start").ok).toBe(false);
    expect(connect(f, "route", "book", "route").ok).toBe(false);
    const one = connect(f, "route", "book", "bye");
    expect(one.ok).toBe(true);
    if (!one.ok) return;
    const again = connect(one.flow, "route", "book", "start");
    expect(again.ok).toBe(false);
    const re = connect(one.flow, "route", "book", "bye");
    expect(re.ok && re.flow.edges.length).toBe(1); // replaced, not duplicated
    expect(openOutcomes(one.flow, "route")).toEqual(["else"]);
    expect(disconnect(one.flow, one.flow.edges[0].id).edges).toHaveLength(0);
  });

  it("condition outcomes follow its rules, and removing a rule drops its connection", () => {
    let f = base();
    const c = connect(f, "route", "book", "bye");
    f = c.ok ? c.flow : f;
    expect(outcomesOf(f.nodes[1])).toEqual(["book", "else"]);
    f = updateNode(f, "route", { settings: { rules: [] } });
    expect(outcomesOf(f.nodes[1])).toEqual(["else"]);
    expect(f.edges).toHaveLength(0);
  });

  it("the greeting can't be removed; other nodes take their connections with them", () => {
    const c = connect(base(), "route", "else", "bye");
    const f = c.ok ? c.flow : base();
    expect(removeNode(f, "start").nodes).toHaveLength(3);
    const g = removeNode(f, "bye");
    expect(g.nodes.map((n) => n.id)).toEqual(["start", "route"]);
    expect(g.edges).toHaveLength(0);
  });

  it("undo and redo", () => {
    let h = history(base());
    h = commit(h, addNode(h.present, "ask", { x: 0, y: 0 }).flow);
    h = commit(h, addNode(h.present, "respond", { x: 0, y: 0 }).flow);
    expect(h.present.nodes).toHaveLength(5);
    h = undo(h);
    expect(h.present.nodes).toHaveLength(4);
    h = undo(h);
    expect(h.present.nodes).toHaveLength(3);
    expect(undo(h)).toBe(h);
    h = redo(h);
    expect(h.present.nodes).toHaveLength(4);
    h = commit(h, removeNode(h.present, "bye"));
    expect(h.future).toHaveLength(0); // a new edit clears redo
  });
});
