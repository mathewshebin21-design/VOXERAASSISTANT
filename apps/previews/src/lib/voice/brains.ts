// Brain adapters. The simulator brain wraps the rule-based receptionist so the
// voice pipeline can be exercised end to end without an LLM. A streaming LLM
// with the same tool contract replaces it in Phase 5 (server-side, so keys never
// reach the browser).

import { greeting, initialState, respond, type SimOptions, type SimState } from "../simulator";
import type { BrainAdapter, BrainChunk } from "./types";
import type { SimEvent } from "../simulator";

function* toChunks(events: SimEvent[], ended: boolean): Generator<BrainChunk> {
  for (const e of events) {
    if (e.kind === "agent") yield { type: "text", text: e.text };
    else if (e.kind === "tool") yield { type: "tool", name: e.name, args: e.args, ok: e.ok, result: e.result };
    else if (e.kind === "guardrail") yield { type: "guardrail", rule: e.rule, text: e.text };
    else if (e.kind === "citation") yield { type: "citation", title: e.title, version: e.version };
  }
  if (ended) yield { type: "end_call" };
}

export class SimulatorBrain implements BrainAdapter {
  readonly name = "Rule-based receptionist (local)";
  readonly costPerMinGbp = 0;
  state: SimState = initialState();
  constructor(private opts: () => SimOptions, private onState?: (s: SimState) => void) {}
  reset() { this.state = initialState(); this.onState?.(this.state); }
  async *greet(): AsyncIterable<BrainChunk> {
    yield* toChunks(greeting(this.opts().persona).filter((e) => e.kind !== "state"), false);
  }
  async *respond(text: string): AsyncIterable<BrainChunk> {
    const { events, state } = respond(text, this.state, this.opts());
    this.state = state;
    this.onState?.(state);
    yield* toChunks(events, state.stage === "ended");
  }
}

/** Last-resort brain: never claims to book anything, only takes a message. */
export class MessageTakerBrain implements BrainAdapter {
  readonly name = "Message-taker fallback (local)";
  readonly costPerMinGbp = 0;
  private asked = false;
  reset() { this.asked = false; }
  async *greet(): AsyncIterable<BrainChunk> { yield { type: "text", text: "Hello, you've reached the salon. I can take a message for the team." }; }
  async *respond(text: string): AsyncIterable<BrainChunk> {
    if (!this.asked) { this.asked = true; yield { type: "text", text: "I can't check bookings right now, but I'll pass your message on. What's your name and the best number to call you back?" }; return; }
    yield { type: "tool", name: "take_message", args: { message: text.slice(0, 200) }, ok: true, result: "Message saved for the team (simulated)" };
    yield { type: "text", text: "Thanks — I've passed that on and someone will call you back as soon as they can." };
  }
}
