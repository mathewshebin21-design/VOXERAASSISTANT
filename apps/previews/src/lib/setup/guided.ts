// The free, guided setup assistant: one question at a time, everyday answers understood by
// ./parse, every interpretation shown back before it is saved. Pure state machine; the UI
// performs the returned actions against the API and reports back.
//
// It is the first thing a new business talks to, so it has to cope with however owners
// actually write: corrections ("yes but Saturday 9-5"), edits to a list before saving
// ("remove head shave", "skin fade £25"), questions ("what does capacity mean?"), and
// moving around ("go back", "change the hours"). When it is unsure it asks; it never saves
// a guess without showing it first.

import { SECTORS } from "../dashboards";
import {
  DAY_NAMES, describeDay, describeWeek, isSkip, isYes, parseAddress, parseCount, parseHours, parsePhone, parseSector,
  parseServices, yesBut, type ParsedService, type Week,
} from "./parse";
import { templateFor, type BusinessTemplate } from "./templates";

export const STEPS = ["type", "phone", "address", "hours", "services", "capacity", "receptionist", "done"] as const;
export type StepId = (typeof STEPS)[number];
export const STEP_LABEL: Record<StepId, string> = {
  type: "Business type", phone: "Phone", address: "Address", hours: "Opening hours", services: "Services",
  capacity: "Capacity", receptionist: "Receptionist", done: "Done",
};

/** A service ready to save. Templates also give a category and a clean-down buffer. */
export interface ServiceDraft {
  name: string;
  duration_min: number;
  price_from_pence: number | null;
  requires_patch_test: boolean;
  category?: string;
  buffer_min?: number;
}

export type SetupAction =
  | { type: "profile"; patch: { sector?: string; phone?: string; address_line1?: string | null; city?: string | null; postcode?: string | null } }
  | { type: "hours"; week: Week }
  /** `description` (house policies from a template) is saved only if the business has none yet. */
  | { type: "services"; services: ServiceDraft[]; description?: string }
  | { type: "capacity"; capacity: number }
  | { type: "agent"; name: string; greeting: string };

export interface GuidedState {
  step: StepId;
  businessName: string;
  /** The business type, once known: it unlocks that type's ready-made template. */
  sector?: string | null;
  pending: { kind: "hours"; week: Week } | { kind: "services"; services: ServiceDraft[]; description?: string } | null;
}

export interface Turn { state: GuidedState; say: string[]; action?: SetupAction }

const DEFAULT_MINUTES = 30;
const USE_TEMPLATE = /^\s*(?:yes,?\s+)?(?:please\s+)?(?:use|load|start from|go with)?\s*(?:the\s+|a\s+|your\s+)?(?:template|standard|default|typical|ready-?made)\b/i;
const QUESTION = /^\s*(what(?! about)|why|how(?! about)|who|which|where|when|can|could|do|does|is|are|should|will|would|help|explain|i don'?t (understand|get|know)|not sure|confused|huh|eh)\b|\?\s*$/i;
const BACK = /^\s*(?:go\s+)?back(?:\s+(?:one|a step))?\s*$|^\s*(previous( step)?|undo|last (step|question))\s*$/i;
const RESTART = /^\s*(start (again|over|from scratch)|restart|from the (start|beginning)|begin again)\b/i;
const JUMP = /\b(?:go back to|back to|change|edit|redo|update|fix|go to)\s+(?:the\s+|my\s+|our\s+)?(business type|type of business|type|phone( number)?|number|address|opening hours|hours|times|services|service list|menu|price list|capacity|chairs|receptionist( name)?)\b/i;
const JUMP_TO: [RegExp, StepId][] = [
  [/type/, "type"], [/phone|number/, "phone"], [/address/, "address"], [/hours|times/, "hours"],
  [/service|menu|price/, "services"], [/capacity|chairs/, "capacity"], [/receptionist/, "receptionist"],
];
const gbp = (p: number) => `£${(p / 100).toFixed(p % 100 ? 2 : 0)}`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const sectorLabel = (v: string) => SECTORS.find((s) => s.value === v)?.label ?? v;

export function prompt(step: StepId, businessName: string, sector?: string | null): string {
  const tpl = templateFor(sector);
  if (tpl && step === "hours") return `${basePrompt(step, businessName)}\nOr say “template” to start from typical ${tpl.label.toLowerCase()} hours.`;
  if (tpl && step === "services") return `${basePrompt(step, businessName)}\nOr say “template” to load a ready-made ${tpl.label.toLowerCase()} menu (${tpl.services.length} services with times and prices, plus booking policies) that you can edit before saving.`;
  return basePrompt(step, businessName);
}

function basePrompt(step: StepId, businessName: string): string {
  switch (step) {
    case "type": return `What kind of business is ${businessName}? For example: hair salon, barbers, physio clinic, plumbing, restaurant, gym…`;
    case "phone": return "What's the phone number customers should call? (Say “skip” if you'd rather add it later.)";
    case "address": return "What's the address? Street, town and postcode — e.g. “12 High Street, Bristol, BS1 4DJ”.";
    case "hours": return "When are you open? Write it however you like — e.g. “Mon–Fri 9–5:30, Thu till 8, Sat 9–4, Sun closed”. Lunch breaks are fine too (“closed 1–2”).";
    case "services": return "What can customers book? One per line: name, how long it takes, and the starting price. e.g.\nWomen's cut, 60 min, £45\nGents cut, 30 min, £20";
    case "capacity": return "How many customers can you see at the same time? (Staff on shift, or chairs/rooms if there are fewer — a number like 2.)";
    case "receptionist": return "Last one: what should your AI receptionist be called? (e.g. Rye, Ava, Sam)";
    case "done": return "That's everything for now.";
  }
}

const HELP: Record<StepId, string> = {
  type: "This tells me what sort of business you run, so your dashboard uses the right words (appointments, jobs, reservations…) and I can offer a ready-made template if there is one. Say it in your own words — “barbers”, “dog groomer”, “plumber” all work.",
  phone: "This is the number the receptionist gives out when callers ask, and where messages say to call back. Any UK number works — mobile or landline.",
  address: "Callers often ask where you are. Give the street, town and postcode. If you don't have premises (you travel to customers), say “skip”.",
  hours: "The receptionist only offers appointments inside these hours, and tells callers when you're open. You can include lunch breaks (“closed 1–2”), late nights (“Thu till 8”), split days (“9–12 and 2–6”) and closed days.",
  services: "These are the things callers can book. The length tells the booking engine how much time to block; the price is a “from” price the receptionist can quote. If you give a range (£18–£25) I'll use the lowest as the starting price. Before saving you can say “remove kids cut”, “add beard dye 20 min £15” or “skin fade £25”.",
  capacity: "This is how many appointments can run at the same moment — usually the number of staff working (or chairs, if there are fewer). With 2 barbers on, two customers can be booked for 10am, but not three.",
  receptionist: "This is the name the AI uses when it answers: “Hi, I'm Ava, the AI receptionist”. Callers are always told they're speaking to an AI, as UK rules expect. Pick any short name.",
  done: "Setup is finished. You can say “change the hours”, “edit services” or “go back” to change anything, or edit it in Workspace.",
};

export function next(step: StepId, skip: ReadonlySet<StepId> = new Set()): StepId {
  let i = STEPS.indexOf(step) + 1;
  while (STEPS[i] !== "done" && skip.has(STEPS[i])) i++;
  return STEPS[i];
}

// ---- services: matching names, showing lists, editing before save ----

/** Comparable form of a service name: "Kids' Cuts & Shapes" ≈ "kid cut and shape". */
const key = (s: string) =>
  s.toLowerCase().replace(/&/g, " and ").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)).join(" ");

/**
 * Indexes of the services a name refers to: an exact match; else the same name ignoring a
 * bracketed note; else every service whose name (not its bracketed note) has all the words
 * typed, in order ("hot towel shave" → "Hot towel cut-throat shave").
 */
export function findService(name: string, list: { name: string }[]): number[] {
  const k = key(name);
  if (!k) return [];
  const exact = list.flatMap((s, i) => (key(s.name) === k ? [i] : []));
  if (exact.length) return exact;
  // "kids cut" → "Kids' cut (under 12)": the same name once the bracketed note is ignored.
  const bare = list.flatMap((s, i) => (key(s.name.replace(/\([^)]*\)/g, " ")) === k ? [i] : []));
  if (bare.length) return bare;
  const words = k.split(" ");
  const inOrder = (name: string) => {
    const ws = key(name.replace(/\([^)]*\)/g, " ")).split(" ");
    let at = 0;
    for (const w of words) { at = ws.indexOf(w, at); if (at < 0) return false; at++; }
    return true;
  };
  return list.flatMap((s, i) => (inOrder(s.name) ? [i] : []));
}

const describeService = (s: ServiceDraft, note = "") =>
  `• ${s.name} — ${s.duration_min} min${note}${s.price_from_pence === null ? ", no price" : s.price_from_pence === 0 ? ", free" : `, from ${gbp(s.price_from_pence)}`}${s.requires_patch_test ? ", needs a patch test" : ""}`;

function describeServices(list: ServiceDraft[], notes: string[] = []): string {
  const cats = [...new Set(list.map((s) => s.category ?? ""))];
  const line = (s: ServiceDraft) => describeService(s, notes[list.indexOf(s)] ?? "");
  if (cats.length === 1) return list.map(line).join("\n");
  return cats.map((c) => `${c || "Other"}:\n${list.filter((s) => (s.category ?? "") === c).map(line).join("\n")}`).join("\n\n");
}

/** Turns parsed lines into drafts, filling a missing length from the template (or 30 minutes). */
function toDrafts(parsed: ParsedService[], tpl: BusinessTemplate | null): { drafts: ServiceDraft[]; notes: string[]; guessed: number; typical: number } {
  let guessed = 0, typical = 0;
  const notes: string[] = [];
  const drafts = parsed.map((s) => {
    const match = tpl ? findService(s.name, tpl.services) : [];
    const t = match.length === 1 ? tpl!.services[match[0]] : null;
    let duration = s.duration_min;
    let note = "";
    if (duration === null && t) { duration = t.duration_min; note = ` (typical for ${tpl!.label.toLowerCase()}s)`; typical++; }
    if (duration === null) { duration = DEFAULT_MINUTES; note = " (assumed)"; guessed++; }
    notes.push(note);
    const category = s.category ?? t?.category;
    return {
      name: s.name, duration_min: duration, price_from_pence: s.price_from_pence, requires_patch_test: s.requires_patch_test,
      ...(category ? { category } : {}), ...(t ? { buffer_min: t.buffer_min } : {}),
    };
  });
  return { drafts, notes, guessed, typical };
}

function readNotes(parsed: ParsedService[], unparsed: string[], guessed: number, typical: number, tpl: BusinessTemplate | null): string[] {
  const say: string[] = [];
  const notes = parsed.flatMap((s) => s.notes.map((n) => `${s.name}: ${n}`));
  if (notes.length) say.push(`I assumed: ${notes.join("; ")}.`);
  if (typical) say.push(`Where you didn't give a length I've used the typical time for ${tpl!.label.toLowerCase()}s.`);
  if (guessed) say.push(`Where you didn't give a length I've assumed ${DEFAULT_MINUTES} minutes — say e.g. “${parsed.find((s) => s.duration_min === null)?.name ?? "Kids cut"} 20 min” to change it.`);
  if (unparsed.length) say.push(`I couldn't use: “${unparsed.join("”, “")}”.`);
  return say;
}

const REMOVE = /^\s*(?:please\s+)?(?:remove|delete|drop|take (?:off|out)|get rid of|cross off|scrap|lose|no|without|(?:we\s+)?don'?t (?:do|offer|need|want))\s+(?:the\s+)?(.+?)\s*[.!]?\s*$/is;
const ADD = /^\s*(?:please\s+)?(?:and\s+)?(?:also\s+)?(?:add|plus|include|put in)\s+(.+)$/is;
const CHANGE = /^\s*(?:please\s+)?(?:change|make|set|update|correct|actually|but|and)\s+(.+)$/is;
const ASK_TEMPLATE_EDITS = "You can change it first: e.g. “remove head shave”, “skin fade £25”, “add beard dye 20 min £15”.";

type Pending = Extract<GuidedState["pending"], { kind: "services" }>;

/** Edits a pending service list. Returns null when the message isn't an edit (it's a new list). */
function editServices(state: GuidedState, pend: Pending, text: string, tpl: BusinessTemplate | null): Turn | null {
  const body = yesBut(text) ?? text;
  const forced = yesBut(text) !== null;
  let list = [...pend.services];
  const done: string[] = [];
  const problems: string[] = [];
  const keep = (say: string[]): Turn => ({ state: { ...state, pending: { ...pend, services: list } }, say });
  const confirm = () => `The list now has ${plural(list.length, "service")}. Shall I save them? (yes, or keep editing)`;

  if (/^\s*(start the list (again|over)|clear (the|my) list|replace (the|my|whole) list|start again with the list|new list)\b/i.test(body)) {
    return { state: { ...state, pending: null }, say: ["OK, the list is cleared. Type your services, one per line."] };
  }
  const rm = body.match(REMOVE);
  if (rm) {
    // "kids cut, head shave and perm or texturising": try each piece whole before splitting it
    // further, because service names contain "and" and "or" themselves.
    const pieces = (s: string, seps: RegExp[]): string[] =>
      findService(s, list).length === 1 || !seps.length ? [s] : s.split(seps[0]).flatMap((x) => pieces(x, seps.slice(1)));
    for (const p of pieces(rm[1], [/\s*,\s*/, /\s+(?:and|&)\s+/i, /\s+or\s+/i])) {
      {
        const hit = findService(p, list);
        if (hit.length === 1) { done.push(`removed ${list[hit[0]].name}`); list = list.filter((_, i) => i !== hit[0]); }
        else if (hit.length > 1) problems.push(`“${p}” matches ${hit.map((i) => list[i].name).join(", ")} — which one? Type the full name.`);
        else problems.push(`I can't find “${p}” in the list.`);
      }
    }
    return keep([...(done.length ? [`Done — ${done.join(", ")}.`] : []), ...problems, confirm()]);
  }

  const add = body.match(ADD);
  if (add) {
    const { services, unparsed } = parseServices(add[1]);
    if (!services.length) return keep([`I couldn't read a service in “${add[1]}”. Try “add beard dye 20 min £15”.`]);
    const { drafts, notes, guessed, typical } = toDrafts(services, tpl);
    const lines: string[] = [];
    drafts.forEach((d, i) => {
      const at = findService(d.name, list).filter((j) => key(list[j].name) === key(d.name));
      if (at.length) list[at[0]] = { ...list[at[0]], ...d }; else list.push(d);
      lines.push(describeService(d, notes[i]));
    });
    return keep([`Added:\n${lines.join("\n")}`, ...readNotes(services, unparsed, guessed, typical, tpl), `${confirm()} (To replace the whole list instead, say “start the list again”.)`]);
  }

  // "skin fade £25", "change kids cut to 20 min", "yes but hot towel shave is £25".
  const ch = body.match(CHANGE);
  const { services, unparsed } = parseServices(ch?.[1] ?? body);
  if (!services.length) return forced || ch ? keep([`I didn't follow that change. Try “skin fade £25”, “remove head shave” or “add beard dye 20 min £15”.`]) : null;
  const hits = services.map((s) => findService(s.name, list));
  if (!ch && !forced && hits.every((h) => h.length === 0)) {
    // Nothing in the list matches: these are new services. Add them rather than throwing away
    // a list the owner has already seen; "start the list again" replaces it on purpose.
    return editServices(state, pend, `add ${body}`, tpl);
  }
  services.forEach((s, n) => {
    const h = hits[n];
    if (h.length !== 1) { problems.push(h.length ? `“${s.name}” matches ${h.map((i) => list[i].name).join(", ")} — which one?` : `I can't find “${s.name}” in the list — say “add ${s.name} …” to add it.`); return; }
    if (s.duration_min === null && s.price_from_pence === null && !s.requires_patch_test) { problems.push(`What should change for ${list[h[0]].name}? Give a time or a price.`); return; }
    const cur = list[h[0]];
    list[h[0]] = {
      ...cur,
      ...(s.duration_min !== null ? { duration_min: s.duration_min } : {}),
      ...(s.price_from_pence !== null ? { price_from_pence: s.price_from_pence } : {}),
      ...(s.requires_patch_test ? { requires_patch_test: true } : {}),
    };
    done.push(describeService(list[h[0]]).slice(2));
  });
  if (unparsed.length) problems.push(`I couldn't use: “${unparsed.join("”, “")}”.`);
  const notes = services.flatMap((s) => s.notes.map((x) => `${s.name}: ${x}`));
  return keep([...(done.length ? [`Updated: ${done.join("; ")}.`] : []), ...(notes.length ? [`I assumed: ${notes.join("; ")}.`] : []), ...problems, confirm()]);
}

// ---- hours: corrections merge into what was shown ----

function editHours(state: GuidedState, week: Week, text: string): Turn | null {
  const but = yesBut(text);
  const body = (but ?? text).replace(/^\s*(?:please\s+)?(?:change|make|set|update|actually|but|also|and|plus)\s+/i, "");
  const explicit = but !== null || body !== (but ?? text);
  const r = parseHours(body, week);
  if (!r.understood) return explicit ? { state, say: ["I didn't follow that change. Try “Saturday 9–5” or “Sunday closed”."] } : null;
  if (!explicit && r.touched.length >= 3) return null; // a whole new week: read it fresh
  if (r.unparsed.length && !r.touched.length) return { state, say: [`I didn't follow “${r.unparsed.join("”, “")}”. Try “Saturday 9–5”, “Thursday till 8” or “Sunday closed”.`] };
  const merged = week.map((d, i) => (r.touched.includes(i) ? r.week[i] : d));
  const changed = r.touched.map((d) => `${DAY_NAMES[d]} ${describeDay(merged[d])}`);
  const say = [`Changed: ${changed.join(", ")}.`, describeWeek(merged).join("\n")];
  if (r.assumptions.length) say.push(`I assumed: ${r.assumptions.join("; ")}.`);
  if (r.unparsed.length) say.push(`I couldn't use: “${r.unparsed.join("”, “")}”.`);
  say.push("Shall I save these hours? (yes, or keep changing)");
  return { state: { ...state, pending: { kind: "hours", week: merged } }, say };
}

function showHours(state: GuidedState, week: Week, intro: string, extra: string[] = []): Turn {
  return { state: { ...state, pending: { kind: "hours", week } }, say: [intro, describeWeek(week).join("\n"), ...extra, "Shall I save these hours? (yes, or tell me what to change — e.g. “Sunday closed”)"] };
}

/** Handles one message from the person setting up. */
export function reply(state: GuidedState, input: string, skip: ReadonlySet<StepId> = new Set()): Turn {
  const text = input.trim();
  const ask = (step: StepId = state.step) => prompt(step, state.businessName, state.sector);
  const move = (say: string[], action?: SetupAction): Turn => ({ state: { ...state, pending: null }, say, action });
  const goTo = (step: StepId, intro: string): Turn => ({ state: { ...state, step, pending: null }, say: [intro, ask(step)] });
  if (!text) return { state, say: [ask()] };
  const tpl = templateFor(state.sector);

  // Getting around: restart, back, or jump to a named step.
  if (RESTART.test(text)) return goTo("type", "Sure — let's start from the top. Anything already saved stays saved until you change it.");
  if (BACK.test(text)) {
    const i = Math.max(0, STEPS.indexOf(state.step) - 1);
    return goTo(STEPS[i], `OK, back to ${STEP_LABEL[STEPS[i]].toLowerCase()}.`);
  }
  const jump = text.match(JUMP);
  const target = jump ? JUMP_TO.find(([re]) => re.test(jump[1].toLowerCase()))?.[1] : undefined;
  if (target && target !== state.step) return goTo(target, `OK, let's change the ${STEP_LABEL[target].toLowerCase()}.`);

  // A pending interpretation waits for a yes; anything else is a correction or a new answer.
  if (state.pending && isYes(text)) {
    if (state.pending.kind === "hours") return move(["Saving your opening hours…"], { type: "hours", week: state.pending.week });
    const { services, description } = state.pending;
    return move([`Saving ${plural(services.length, "service")}…`], { type: "services", services, ...(description ? { description } : {}) });
  }
  if (isSkip(text) && state.step !== "done") {
    const step = next(state.step, skip);
    return { state: { ...state, step, pending: null }, say: ["No problem — you can add that later.", ask(step)] };
  }
  if (/^\s*(no|nope|nah|wrong|that'?s wrong|not right|not quite)\s*[.!]?\s*$/i.test(text)) {
    return { state, say: [state.pending ? "No problem — tell me what to change, or type it again." : `No problem. ${ask()}`] };
  }
  const help = (): Turn => ({ state, say: [HELP[state.step], ask()] });
  if (QUESTION.test(text) && (state.step === "receptionist" || state.step === "capacity" || state.step === "done" || state.step === "type")) {
    if (!(state.step === "type" && parseSector(text)) && !(state.step === "capacity" && parseCount(text) !== null)) return help();
  }
  const orHelp = (t: Turn): Turn => (QUESTION.test(text) ? help() : t);

  if ((state.step === "hours" || state.step === "services") && USE_TEMPLATE.test(text) && !tpl) {
    return { state: { ...state, pending: null }, say: [`I don't have a ready-made template for ${state.sector ? sectorLabel(state.sector).toLowerCase() : "this type of business"} yet, so please type yours in.`, basePrompt(state.step, state.businessName)] };
  }
  const templateRest = text.match(/\b(?:but|except|with)\b\s*(.+)$/is)?.[1];

  switch (state.step) {
    case "type": {
      const sector = parseSector(text) ?? SECTORS.find((s) => s.label.toLowerCase() === text.toLowerCase())?.value ?? null;
      if (!sector) return orHelp({ state, say: [`I didn't quite catch the type of business. Is it closest to: ${SECTORS.map((s) => s.label).join(", ")}? (If none fit, say “other”.)`] });
      const t = templateFor(sector);
      const say = [`Got it — ${sectorLabel(sector)}. That also sets your dashboard layout.`];
      if (t) say.push(`I've got a ready-made ${t.label.toLowerCase()} template — when we get to hours and services, just say “template”.`);
      return { state: { ...state, pending: null, sector }, say, action: { type: "profile", patch: { sector } } };
    }
    case "phone": {
      const phone = parsePhone(text);
      if (!phone) return orHelp({ state, say: ["That doesn't look like a UK phone number. Could you type it again, e.g. 0117 496 0123 or 07700 900123?"] });
      return move([`Thanks — ${phone}.`], { type: "profile", patch: { phone } });
    }
    case "address": {
      const a = parseAddress(text);
      if (!a.address_line1 && !a.city && !a.postcode) return orHelp({ state, say: ["Sorry, I couldn't read that as an address. Try “street, town, postcode”."] });
      const shown = [a.address_line1, a.city, a.postcode].filter(Boolean).join(", ");
      const missing = [!a.city && "town", !a.postcode && "postcode"].filter(Boolean);
      return move([`Noted: ${shown}.${missing.length ? ` (No ${missing.join(" or ")} — you can add ${missing.length > 1 ? "them" : "it"} in Workspace.)` : ""}`], { type: "profile", patch: a });
    }
    case "hours": {
      if (tpl && USE_TEMPLATE.test(text)) {
        const shown = showHours(state, tpl.week, `Typical ${tpl.label.toLowerCase()} hours:`);
        return (templateRest && editHours(shown.state, tpl.week, `change ${templateRest}`)) || shown;
      }
      if (state.pending?.kind === "hours") {
        const edited = editHours(state, state.pending.week, text);
        if (edited) return edited;
      }
      const r = parseHours(text);
      if (!r.understood) return orHelp({ state, say: ["I couldn't work out the days and times from that. Try something like “Tue–Sat 9–5:30, Sun and Mon closed”. Give the days as well as the times."] });
      const extra: string[] = [];
      if (r.assumptions.length) extra.push(`I assumed: ${r.assumptions.join("; ")}.`);
      if (r.unparsed.length) extra.push(`I couldn't use: “${r.unparsed.join("”, “")}”.`);
      const unsaid = [0, 1, 2, 3, 4, 5, 6].filter((d) => !r.touched.includes(d));
      if (unsaid.length && unsaid.length < 7) extra.push(`You didn't mention ${unsaid.map((d) => DAY_NAMES[d]).join(", ")}, so I've marked ${unsaid.length === 1 ? "it" : "them"} closed.`);
      return showHours(state, r.week, "Here's what I understood:", extra);
    }
    case "services": {
      if (tpl && USE_TEMPLATE.test(text)) {
        const services: ServiceDraft[] = tpl.services.map((s) => ({ ...s, requires_patch_test: false }));
        const loaded: Turn = {
          state: { ...state, pending: { kind: "services", services, description: tpl.description } },
          say: [`Here's the ${tpl.label.toLowerCase()} menu:`, describeServices(services),
            "I'll also add standard booking policies (walk-ins, 10-minute late grace, 24-hour cancellation, payment) to your business description so the receptionist can answer those questions — unless you've already written one.",
            `Prices are starting prices at typical UK high-street rates. ${ASK_TEMPLATE_EDITS}`,
            "Shall I save these? (yes, or tell me what to change)"],
        };
        if (templateRest && loaded.state.pending?.kind === "services") {
          const edited = editServices(loaded.state, loaded.state.pending, `change ${templateRest}`.replace(/^change\s+(remove|delete|drop|no|without|add|plus)\b/i, "$1"), tpl);
          if (edited) return { ...edited, say: [loaded.say[0], loaded.say[1], loaded.say[2], ...edited.say] };
        }
        return loaded;
      }
      if (state.pending?.kind === "services") {
        const edited = editServices(state, state.pending, text, tpl);
        if (edited) return edited;
      }
      const { services, unparsed } = parseServices(text);
      if (!services.length) return orHelp({ state, say: ["I couldn't find any services in that. Put one per line, like “Women's cut, 60 min, £45”."] });
      const { drafts, notes, guessed, typical } = toDrafts(services, tpl);
      const say = ["Here's your list:", describeServices(drafts, notes), ...readNotes(services, unparsed, guessed, typical, tpl)];
      say.push("Shall I save these? (yes, or tell me what to change — e.g. “kids cut 20 min”, “remove blow dry”)");
      return { state: { ...state, pending: { kind: "services", services: drafts } }, say };
    }
    case "capacity": {
      const n = parseCount(text);
      if (n === null || !Number.isInteger(n) || n < 1 || n > 50) return orHelp({ state, say: ["Please give a number between 1 and 50 — how many customers can be seen at once?"] });
      const several = (text.match(/\d+|\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/gi) ?? []).length > 1 && !/\b(me|myself|i)\s+(and|plus|\+)/i.test(text);
      return move([`${n} at a time${several ? " (the smaller number you gave — you can't see more people at once than you have staff or chairs)" : ""} — the booking engine won't overbook beyond that.`], { type: "capacity", capacity: n });
    }
    case "receptionist": {
      const name = text
        .replace(/^(?:(?:let'?s|lets|we'?ll|i'?ll)\s+(?:go with|call (?:it|her|him|them)|use|have)|call (?:it|her|him|them)|name (?:it|her|him|them)|it'?s|it should be|i'?d like|i want|how about|maybe|what about|go with|use|i think)\s+/i, "")
        .replace(/\s+(?:please|thanks|thank you|pls|ta)\b.*$/i, "")
        .replace(/[^\p{L}\p{N} '-]/gu, "").trim().slice(0, 40);
      if (!name || name.split(/\s+/).length > 3) return { state, say: ["What name would you like? Just the name on its own is fine — e.g. “Ava”."] };
      const pretty = name.replace(/(^|[\s-])(\p{L})/gu, (_, b, c) => b + c.toUpperCase());
      const greeting = `Hello, you're through to ${state.businessName}. I'm ${pretty}, the AI receptionist — how can I help?`;
      return move([`Lovely — meet ${pretty}. Their greeting: “${greeting}”`], { type: "agent", name: pretty, greeting });
    }
    case "done":
      return { state, say: ["You're all set up. You can say “change the hours”, “edit services” or “go back”, or edit anything in Workspace."] };
  }
}

/** After an action succeeds, move on and ask the next question. */
export function advance(state: GuidedState, skip: ReadonlySet<StepId> = new Set()): Turn {
  const step = next(state.step, skip);
  const say = step === "done"
    ? ["🎉 That's the essentials done. Next: go Available on the Desk so transferred callers reach you, invite your team, and try a test call in the Voice lab."]
    : [prompt(step, state.businessName, state.sector)];
  return { state: { ...state, step, pending: null }, say };
}
