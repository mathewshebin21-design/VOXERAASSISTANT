// Agent Studio: the flow document and the pure operations the editor performs on it.
// The API (services/api/app/flows) is the authority: it validates on every save and publish.
// These helpers keep the editor honest in between (one connection per outcome, nothing into
// Start, outcomes that exist) so most mistakes never reach the server.

export type NodeType =
  | "start" | "ask" | "respond" | "knowledge" | "condition" | "hours_check" | "service_lookup"
  | "availability" | "booking" | "collect_info" | "tool" | "escalate" | "transfer" | "end";

export interface FlowNode { id: string; type: NodeType; label: string; position: { x: number; y: number }; settings: Record<string, unknown> }
export interface FlowEdge { id: string; source: string; outcome: string; target: string }
export interface FlowDoc { schema_version: 1; settings: { persona: string; max_turns: number }; nodes: FlowNode[]; edges: FlowEdge[] }
export interface Rule { id: string; variable: string; op: string; value: string; label: string }

export type Field =
  | { key: string; label: string; kind: "text" | "textarea"; placeholder?: string; help?: string; max?: number }
  | { key: string; label: string; kind: "select"; options: { value: string; label: string }[]; help?: string }
  | { key: string; label: string; kind: "number"; min: number; max: number; help?: string }
  | { key: string; label: string; kind: "checks"; options: { value: string; label: string }[]; help?: string }
  | { key: string; label: string; kind: "toggle"; help?: string }
  | { key: string; label: string; kind: "rules"; help?: string };

export interface NodeMeta {
  label: string;
  group: "Talk" | "Logic" | "Business" | "People" | "End";
  blurb: string;
  color: string; // "r g b"
  outcomes: string[];
  defaults: Record<string, unknown>;
  fields: Field[];
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d, i) => ({ value: String(i), label: d }));

export const NODE_META: Record<NodeType, NodeMeta> = {
  start: {
    label: "Greeting", group: "Talk", color: "167 139 250", blurb: "The first thing callers hear. Must say it's an AI.",
    outcomes: ["next"], defaults: { greeting: "Hi, thanks for calling {business}. I'm the AI receptionist. How can I help?" },
    fields: [{ key: "greeting", label: "Greeting", kind: "textarea", max: 600, help: "Must tell callers they're speaking to an AI. {business} is replaced with your business name." }],
  },
  ask: {
    label: "Ask a question", group: "Talk", color: "167 139 250", blurb: "Asks, waits, and saves the answer.",
    outcomes: ["answered", "no_answer"], defaults: { question: "", variable: "answer", kind: "text", choices: [], retries: 1 },
    fields: [
      { key: "question", label: "Question", kind: "textarea", max: 600 },
      { key: "variable", label: "Save the answer as", kind: "text", placeholder: "preferred_barber", help: "Lower case, letters, numbers and _." },
      { key: "kind", label: "Expect", kind: "select", options: ["text", "name", "phone", "date", "time", "service", "yes_no"].map((v) => ({ value: v, label: v.replace("_", "/") })) },
      { key: "retries", label: "Ask again if unclear", kind: "number", min: 0, max: 3 },
    ],
  },
  respond: {
    label: "Say something", group: "Talk", color: "167 139 250", blurb: "A fixed line, then carries on.",
    outcomes: ["next"], defaults: { message: "", mode: "fixed" },
    fields: [{ key: "message", label: "Message", kind: "textarea", max: 600, help: "{business} and saved answers like {preferred_barber} are filled in." }],
  },
  knowledge: {
    label: "Answer a question", group: "Business", color: "103 232 249", blurb: "Answers from your services, hours and details only. Never guesses.",
    outcomes: ["answered", "not_found"], defaults: { topics: ["services", "prices", "hours", "address", "phone", "description"] },
    fields: [{ key: "topics", label: "May answer about", kind: "checks", options: ["services", "prices", "hours", "address", "phone", "description"].map((v) => ({ value: v, label: v })) }],
  },
  condition: {
    label: "Decide", group: "Logic", color: "251 191 36", blurb: "Goes one way or another based on what's known.",
    outcomes: [], defaults: { rules: [{ id: "yes", variable: "intent", op: "equals", value: "book", label: "Wants to book" }] },
    fields: [{ key: "rules", label: "Rules (checked top to bottom; otherwise “else”)", kind: "rules" }],
  },
  hours_check: {
    label: "Open now?", group: "Business", color: "103 232 249", blurb: "Checks your opening hours.",
    outcomes: ["open", "closed"], defaults: {}, fields: [],
  },
  service_lookup: {
    label: "Find the service", group: "Business", color: "103 232 249", blurb: "Matches what they said to one of your services.",
    outcomes: ["found", "ambiguous", "not_found"], defaults: { from_variable: "last_message" },
    fields: [{ key: "from_variable", label: "Match against", kind: "text", help: "last_message, or a saved answer such as service_text." }],
  },
  availability: {
    label: "Find free times", group: "Business", color: "103 232 249", blurb: "Offers only times your diary really has free.",
    outcomes: ["available", "none"], defaults: { part_of_day: "from_caller", offer: 3, exclude_weekdays: [] },
    fields: [
      { key: "part_of_day", label: "Time of day", kind: "select", options: [{ value: "from_caller", label: "As the caller says" }, ...["any", "morning", "afternoon", "evening"].map((v) => ({ value: v, label: v }))] },
      { key: "offer", label: "Times to offer", kind: "number", min: 1, max: 5 },
      { key: "exclude_weekdays", label: "Never offer on", kind: "checks", options: WEEKDAYS },
    ],
  },
  booking: {
    label: "Book it", group: "Business", color: "163 230 53", blurb: "Reads the details back and books only after a clear yes.",
    outcomes: ["booked", "declined", "failed"], defaults: { confirm: true },
    fields: [],
  },
  collect_info: {
    label: "Take details", group: "Talk", color: "167 139 250", blurb: "Collects name, number, email or notes.",
    outcomes: ["collected", "incomplete"], defaults: { fields: ["name", "phone"] },
    fields: [{ key: "fields", label: "Collect", kind: "checks", options: ["name", "phone", "email", "notes"].map((v) => ({ value: v, label: v })) }],
  },
  tool: {
    label: "Run an action", group: "Business", color: "103 232 249", blurb: "Look up, cancel, or leave a message.",
    outcomes: ["success", "failure"], defaults: { tool: "take_message" },
    fields: [{ key: "tool", label: "Action", kind: "select", options: [
      { value: "take_message", label: "Take a message" }, { value: "find_my_appointments", label: "Find their bookings" },
      { value: "cancel_appointment", label: "Cancel their next booking" }, { value: "reschedule_appointment", label: "Reschedule (routes to the team)" },
    ] }],
  },
  escalate: {
    label: "Pass to the team", group: "People", color: "244 114 182", blurb: "Leaves a message in the staff desk queue.",
    outcomes: ["handed_off"], defaults: { reason: "needs the team", urgent: false },
    fields: [{ key: "reason", label: "Reason (for staff)", kind: "text", max: 120 }, { key: "urgent", label: "Urgent", kind: "toggle" }],
  },
  transfer: {
    label: "Put through", group: "People", color: "244 114 182", blurb: "Hands the call to an available person.",
    outcomes: ["transferred", "unavailable"], defaults: { target: "any_available", message: "Of course, I'll put you through to the team now." },
    fields: [
      { key: "target", label: "To", kind: "select", options: [{ value: "any_available", label: "Anyone available" }, { value: "managers", label: "Managers only" }] },
      { key: "message", label: "Say first", kind: "textarea", max: 600 },
    ],
  },
  end: {
    label: "End call", group: "End", color: "150 146 180", blurb: "Says goodbye and ends.",
    outcomes: [], defaults: { message: "Thanks for calling. Goodbye!" },
    fields: [{ key: "message", label: "Goodbye", kind: "textarea", max: 600 }],
  },
};

export const PALETTE: NodeType[] = ["ask", "respond", "condition", "knowledge", "hours_check", "service_lookup", "availability", "booking", "collect_info", "tool", "escalate", "transfer", "end"];

export const OUTCOME_LABEL: Record<string, string> = {
  next: "then", answered: "answered", no_answer: "no answer", not_found: "not found", open: "open", closed: "closed",
  found: "found", ambiguous: "several", available: "chose a time", none: "none free", booked: "booked", declined: "said no",
  failed: "failed", collected: "got them", incomplete: "missing", success: "done", failure: "failed", handed_off: "passed on",
  transferred: "connected", unavailable: "nobody free", else: "else",
};

export function outcomesOf(n: FlowNode): string[] {
  if (n.type === "condition") return [...((n.settings.rules as Rule[] | undefined) ?? []).map((r) => r.id), "else"];
  return NODE_META[n.type].outcomes;
}

export function uid(taken: Iterable<string>, base: string): string {
  const set = new Set(taken);
  const clean = base.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 34) || "node";
  if (!set.has(clean)) return clean;
  for (let i = 2; ; i++) if (!set.has(`${clean}-${i}`)) return `${clean}-${i}`;
}

export function addNode(f: FlowDoc, type: NodeType, position: { x: number; y: number }): { flow: FlowDoc; id: string } {
  const id = uid(f.nodes.map((n) => n.id), type.replace("_", "-"));
  const node: FlowNode = { id, type, label: NODE_META[type].label, position, settings: structuredClone(NODE_META[type].defaults) };
  return { flow: { ...f, nodes: [...f.nodes, node] }, id };
}

export function removeNode(f: FlowDoc, id: string): FlowDoc {
  if (f.nodes.find((n) => n.id === id)?.type === "start") return f; // the greeting can't be removed
  return { ...f, nodes: f.nodes.filter((n) => n.id !== id), edges: f.edges.filter((e) => e.source !== id && e.target !== id) };
}

export type ConnectResult = { ok: true; flow: FlowDoc } | { ok: false; reason: string };

export function connect(f: FlowDoc, source: string, outcome: string, target: string): ConnectResult {
  const src = f.nodes.find((n) => n.id === source);
  const dst = f.nodes.find((n) => n.id === target);
  if (!src || !dst) return { ok: false, reason: "That step no longer exists." };
  if (dst.type === "start") return { ok: false, reason: "Nothing can lead back into the greeting." };
  if (source === target) return { ok: false, reason: "A step can't lead to itself." };
  if (!outcomesOf(src).includes(outcome)) return { ok: false, reason: `“${src.label}” has no “${outcome}” outcome.` };
  const edges = f.edges.filter((e) => !(e.source === source && e.outcome === outcome)); // one connection per outcome
  const id = uid(edges.map((e) => e.id), `${source}--${outcome}`);
  return { ok: true, flow: { ...f, edges: [...edges, { id, source, outcome, target }] } };
}

export function disconnect(f: FlowDoc, edgeId: string): FlowDoc {
  return { ...f, edges: f.edges.filter((e) => e.id !== edgeId) };
}

export function updateNode(f: FlowDoc, id: string, patch: Partial<Pick<FlowNode, "label" | "settings" | "position">>): FlowDoc {
  const nodes = f.nodes.map((n) => (n.id === id ? { ...n, ...patch, settings: patch.settings ? { ...patch.settings } : n.settings } : n));
  let flow = { ...f, nodes };
  const n = nodes.find((x) => x.id === id);
  if (n?.type === "condition") {
    const valid = new Set(outcomesOf(n)); // removing a rule drops its connection
    flow = { ...flow, edges: flow.edges.filter((e) => e.source !== id || valid.has(e.outcome)) };
  }
  return flow;
}

/** Outcomes of a node that don't lead anywhere yet. */
export function openOutcomes(f: FlowDoc, id: string): string[] {
  const n = f.nodes.find((x) => x.id === id);
  if (!n) return [];
  const used = new Set(f.edges.filter((e) => e.source === id).map((e) => e.outcome));
  return outcomesOf(n).filter((o) => !used.has(o));
}

// -------- undo / redo --------

export interface History { past: FlowDoc[]; present: FlowDoc; future: FlowDoc[] }
const LIMIT = 100;

export const history = (present: FlowDoc): History => ({ past: [], present, future: [] });

export function commit(h: History, next: FlowDoc): History {
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-LIMIT), present: next, future: [] };
}

export function undo(h: History): History {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo(h: History): History {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}
