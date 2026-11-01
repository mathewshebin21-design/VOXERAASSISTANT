// The free, guided setup assistant: one question at a time, everyday answers understood by
// ./parse, every interpretation shown back before it is saved. Pure state machine; the UI
// performs the returned actions against the API and reports back.

import { SECTORS } from "../dashboards";
import { describeWeek, isSkip, isYes, parseAddress, parseHours, parsePhone, parseSector, parseServices, type ParsedService, type Week } from "./parse";

export const STEPS = ["type", "phone", "address", "hours", "services", "capacity", "receptionist", "done"] as const;
export type StepId = (typeof STEPS)[number];
export const STEP_LABEL: Record<StepId, string> = {
  type: "Business type", phone: "Phone", address: "Address", hours: "Opening hours", services: "Services",
  capacity: "Capacity", receptionist: "Receptionist", done: "Done",
};

export type SetupAction =
  | { type: "profile"; patch: { sector?: string; phone?: string; address_line1?: string | null; city?: string | null; postcode?: string | null } }
  | { type: "hours"; week: Week }
  | { type: "services"; services: (ParsedService & { duration_min: number })[] }
  | { type: "capacity"; capacity: number }
  | { type: "agent"; name: string; greeting: string };

export interface GuidedState {
  step: StepId;
  businessName: string;
  pending: { kind: "hours"; week: Week } | { kind: "services"; services: (ParsedService & { duration_min: number })[] } | null;
}

export interface Turn { state: GuidedState; say: string[]; action?: SetupAction }

const DEFAULT_MINUTES = 30;

export function prompt(step: StepId, businessName: string): string {
  switch (step) {
    case "type": return `What kind of business is ${businessName}? For example: hair salon, barbers, physio clinic, plumbing, restaurant, gym…`;
    case "phone": return "What's the phone number customers should call? (Say “skip” if you'd rather add it later.)";
    case "address": return "What's the address? Street, town and postcode — e.g. “12 High Street, Bristol, BS1 4DJ”.";
    case "hours": return "When are you open? Write it however you like — e.g. “Mon–Fri 9–5:30, Sat 9–4, Sun closed”.";
    case "services": return "What can customers book? One per line: name, how long it takes, and the starting price. e.g.\nWomen's cut, 60 min, £45\nGents cut, 30 min, £20";
    case "capacity": return "How many customers can you see at the same time? (Chairs, rooms or staff on shift — a number like 2.)";
    case "receptionist": return "Last one: what should your AI receptionist be called? (e.g. Rye, Ava, Sam)";
    case "done": return "That's everything for now.";
  }
}

export function next(step: StepId, skip: ReadonlySet<StepId> = new Set()): StepId {
  let i = STEPS.indexOf(step) + 1;
  while (STEPS[i] !== "done" && skip.has(STEPS[i])) i++;
  return STEPS[i];
}

const sectorLabel = (v: string) => SECTORS.find((s) => s.value === v)?.label ?? v;

/** Handles one message from the person setting up. */
export function reply(state: GuidedState, input: string, skip: ReadonlySet<StepId> = new Set()): Turn {
  const text = input.trim();
  const move = (say: string[], action?: SetupAction): Turn => ({ state: { ...state, pending: null, step: state.step }, say, action });
  if (!text) return { state, say: [prompt(state.step, state.businessName)] };

  // A pending interpretation waits for a yes; anything else is taken as a corrected answer.
  if (state.pending && isYes(text)) {
    if (state.pending.kind === "hours") return move(["Saving your opening hours…"], { type: "hours", week: state.pending.week });
    return move([`Saving ${state.pending.services.length} service${state.pending.services.length === 1 ? "" : "s"}…`], { type: "services", services: state.pending.services });
  }
  if (isSkip(text) && state.step !== "done") {
    const step = next(state.step, skip);
    return { state: { ...state, step, pending: null }, say: ["No problem — you can add that later.", prompt(step, state.businessName)] };
  }

  switch (state.step) {
    case "type": {
      const sector = parseSector(text) ?? SECTORS.find((s) => s.label.toLowerCase() === text.toLowerCase())?.value ?? null;
      if (!sector) return { state, say: [`I didn't quite catch the type of business. Is it closest to: ${SECTORS.map((s) => s.label).join(", ")}?`] };
      return move([`Got it — ${sectorLabel(sector)}. That also sets your dashboard layout.`], { type: "profile", patch: { sector } });
    }
    case "phone": {
      const phone = parsePhone(text);
      if (!phone) return { state, say: ["That doesn't look like a UK phone number. Could you type it again, e.g. 0117 496 0123?"] };
      return move([`Thanks — ${phone}.`], { type: "profile", patch: { phone } });
    }
    case "address": {
      const a = parseAddress(text);
      if (!a.address_line1 && !a.city && !a.postcode) return { state, say: ["Sorry, I couldn't read that as an address. Try “street, town, postcode”."] };
      const shown = [a.address_line1, a.city, a.postcode].filter(Boolean).join(", ");
      return move([`Noted: ${shown}.`], { type: "profile", patch: a });
    }
    case "hours": {
      const r = parseHours(text);
      if (!r.understood) return { state, say: ["I couldn't work out the days and times from that. Try something like “Tue–Sat 9–5:30, Sun and Mon closed”."] };
      const say = ["Here's what I understood:", describeWeek(r.week).join("\n")];
      if (r.assumptions.length) say.push(`I assumed: ${r.assumptions.join("; ")}.`);
      if (r.unparsed.length) say.push(`I couldn't use: “${r.unparsed.join("”, “")}”.`);
      say.push("Shall I save these hours? (yes, or type them again)");
      return { state: { ...state, pending: { kind: "hours", week: r.week } }, say };
    }
    case "services": {
      const { services, unparsed } = parseServices(text);
      if (!services.length) return { state, say: ["I couldn't find any services in that. Put one per line, like “Women's cut, 60 min, £45”."] };
      const filled = services.map((s) => ({ ...s, duration_min: s.duration_min ?? DEFAULT_MINUTES }));
      const lines = filled.map((s, i) => `• ${s.name} — ${s.duration_min} min${services[i].duration_min === null ? " (assumed)" : ""}${s.price_from_pence !== null ? `, from £${(s.price_from_pence / 100).toFixed(2)}` : ", no price"}${s.requires_patch_test ? ", needs a patch test" : ""}`);
      const say = ["Here's your list:", lines.join("\n")];
      if (services.some((s) => s.duration_min === null)) say.push(`Where you didn't give a length I've assumed ${DEFAULT_MINUTES} minutes — retype that line with a time to change it.`);
      if (unparsed.length) say.push(`I couldn't use: “${unparsed.join("”, “")}”.`);
      say.push("Shall I save these? (yes, or type the list again)");
      return { state: { ...state, pending: { kind: "services", services: filled } }, say };
    }
    case "capacity": {
      const n = Number(text.match(/\d+/)?.[0] ?? (/\b(one|just me|myself)\b/i.test(text) ? 1 : NaN));
      if (!Number.isInteger(n) || n < 1 || n > 50) return { state, say: ["Please give a number between 1 and 50 — how many customers can be seen at once?"] };
      return move([`${n} at a time — the booking engine won't overbook beyond that.`], { type: "capacity", capacity: n });
    }
    case "receptionist": {
      const name = text.replace(/^(call (it|her|him|them)|it'?s|name it)\s+/i, "").replace(/[^\p{L}\p{N} '-]/gu, "").trim().slice(0, 40);
      if (!name) return { state, say: ["What name would you like? Just one word is fine."] };
      const pretty = name[0].toUpperCase() + name.slice(1);
      const greeting = `Hello, you're through to ${state.businessName}. I'm ${pretty}, the AI receptionist — how can I help?`;
      return move([`Lovely — meet ${pretty}. Their greeting: “${greeting}”`], { type: "agent", name: pretty, greeting });
    }
    case "done":
      return { state, say: ["You're all set up. You can edit anything in Workspace, or ask me to go back to a step."] };
  }
}

/** After an action succeeds, move on and ask the next question. */
export function advance(state: GuidedState, skip: ReadonlySet<StepId> = new Set()): Turn {
  const step = next(state.step, skip);
  const say = step === "done"
    ? ["🎉 That's the essentials done. Next: go Available on the Desk so transferred callers reach you, invite your team, and try a test call in the Voice lab."]
    : [prompt(step, state.businessName)];
  return { state: { ...state, step, pending: null }, say };
}
