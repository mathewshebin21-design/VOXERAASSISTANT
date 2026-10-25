// Conversation graph used by Design C. Node ids match `SimState.node` values
// emitted by the simulator, so the canvas can highlight where a live
// (simulated) conversation currently is.

export type FlowKind = "entry" | "router" | "step" | "tool" | "guard" | "handoff" | "end" | "persona";

export interface FlowNodeDef {
  id: string;
  kind: FlowKind;
  label: string;
  detail: string;
  x: number;
  y: number;
  tool?: string;
}

export const FLOW_NODES: FlowNodeDef[] = [
  { id: "persona", kind: "persona", label: "Persona & voice", detail: "Name, greeting, warmth, voice, pace", x: 0, y: 0 },
  { id: "greet", kind: "entry", label: "Greeting", detail: "AI disclosure + recording notice", x: 300, y: 0 },
  { id: "guard", kind: "guard", label: "Integrity guard", detail: "Blocks instruction override attempts", x: 600, y: 0 },
  { id: "intent", kind: "router", label: "Understand intent", detail: "book · move · cancel · ask · person", x: 300, y: 160 },
  { id: "book", kind: "step", label: "Choose service", detail: "Only agent-bookable services", x: 0, y: 330 },
  { id: "slots", kind: "tool", label: "Find times", detail: "check_availability", tool: "check_availability", x: 0, y: 470 },
  { id: "details", kind: "step", label: "Caller details", detail: "Name (and number from caller ID)", x: 0, y: 610 },
  { id: "confirm", kind: "step", label: "Explicit confirmation", detail: "Read back service, time, stylist", x: 0, y: 750 },
  { id: "booked", kind: "tool", label: "Create booking", detail: "create_booking · idempotent", tool: "create_booking", x: 0, y: 890 },
  { id: "kb", kind: "tool", label: "Answer from knowledge", detail: "search_knowledge · verified only", tool: "search_knowledge", x: 300, y: 330 },
  { id: "fallback", kind: "guard", label: "Don't know", detail: "Decline to guess · offer message", x: 300, y: 470 },
  { id: "escalate", kind: "handoff", label: "Urgent safety", detail: "999 / NHS 111 script + alert owner", x: 600, y: 330 },
  { id: "transfer", kind: "handoff", label: "Warm transfer", detail: "transfer_call with summary", tool: "transfer_call", x: 600, y: 470 },
  { id: "message", kind: "handoff", label: "Take message", detail: "take_message · team notified", tool: "take_message", x: 600, y: 610 },
  { id: "end", kind: "end", label: "Wrap up", detail: "Summary, outcome, analytics", x: 300, y: 890 },
];

export const FLOW_EDGES: { from: string; to: string; label?: string }[] = [
  { from: "persona", to: "greet" },
  { from: "greet", to: "intent" },
  { from: "greet", to: "guard", label: "override attempt" },
  { from: "intent", to: "book", label: "book" },
  { from: "book", to: "slots" },
  { from: "slots", to: "details", label: "slot chosen" },
  { from: "slots", to: "message", label: "no slots / tool error" },
  { from: "details", to: "confirm" },
  { from: "confirm", to: "booked", label: "yes" },
  { from: "confirm", to: "slots", label: "no" },
  { from: "booked", to: "end" },
  { from: "intent", to: "kb", label: "question" },
  { from: "kb", to: "fallback", label: "no verified answer" },
  { from: "kb", to: "end" },
  { from: "fallback", to: "message" },
  { from: "intent", to: "escalate", label: "safety" },
  { from: "intent", to: "transfer", label: "person / frustrated" },
  { from: "transfer", to: "end" },
  { from: "message", to: "end" },
  { from: "escalate", to: "end" },
];

export const KIND_COLOR: Record<FlowKind, string> = {
  persona: "244 114 182",
  entry: "167 139 250",
  router: "167 139 250",
  step: "236 234 255",
  tool: "103 232 249",
  guard: "252 211 77",
  handoff: "190 242 100",
  end: "150 146 180",
};
