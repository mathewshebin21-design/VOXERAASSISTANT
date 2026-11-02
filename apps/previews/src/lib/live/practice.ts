// The free practice receptionist for a signed-in workspace.
//
// It answers from the workspace's own data (services, prices, durations, opening hours,
// address and phone) and finds times from the API's real availability. It is still a
// rule-based stand-in, not the Claude receptionist: it understands common receptionist
// questions and answers the one actually asked, and for anything it can't answer it
// says so and offers to put the caller through. Practice bookings are not written to
// the real diary.

import type { SimEvent } from "../simulator";

export interface CatalogService { id: string; name: string; category: string | null; durationMin: number; pricePence: number | null; requiresPatchTest: boolean; bookable: boolean }
export interface Catalog {
  business: string;
  agentName: string;
  timezone: string;
  services: CatalogService[];
  /** weekday 0 = Monday … 6 = Sunday, times "HH:MM" */
  hours: { weekday: number; opens: string; closes: string }[];
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  description: string | null;
  allowTransfer: boolean;
}

export interface PracticeState {
  stage: "open" | "need_service" | "need_time" | "offered" | "need_name" | "confirming" | "booked" | "transferred" | "ended";
  serviceId?: string;
  /** Candidate services when the caller's words matched more than one. */
  choices?: string[];
  offered: string[];
  chosen?: string;
  name?: string;
  offeredTransfer?: boolean;
  /** The service the conversation is about, for follow-ups like "how much is it?" */
  topic?: string;
  node: string;
  turn: number;
  frustration: number;
  /** Messages in a row it couldn't follow; the second one offers a person. */
  misses?: number;
}

export const practiceInitial = (): PracticeState => ({ stage: "open", offered: [], node: "greet", turn: 0, frustration: 0 });

/** Looks up bookable start times. `on` is a local date (YYYY-MM-DD) or undefined for "next available". */
export type SlotFinder = (serviceId: string, on?: string) => Promise<string[]>;

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const STOP = new Set(["and", "the", "with", "for", "of", "a", "an", "&", "to", "in", "on", "my", "your", "full", "short", "long"]);

const RX = {
  injection: /(ignore (all |your |the )?(previous|prior|above) (instructions|rules)|system prompt|you are now|developer mode|reveal (your|the) (prompt|instructions))/i,
  urgent: /(allergic|reaction|swelling|swollen|can'?t breathe|bleeding|emergency|chemical burn|burning)/i,
  human: /\b(human|real person|someone|somebody|speak to|talk to|manager|owner|staff|member of (the )?team|put me through)\b/i,
  frustrated: /(ridiculous|useless|annoy|angry|furious|rubbish|terrible|waste of time|not happy|unhappy|complain)/i,
  question: /\?\s*$|^(so\s+|and\s+|but\s+|okay\s+|ok\s+|um+\s+|right\s+|great\s+|hi\s+|hello\s+)*(what|what'?s|whats|how|why|when|where|which|who|is|are|do|does|did|can|could|will|would|should|tell me|explain|any)\b/i,
  listServices: /(what|which)\b.*\b(services|treatments|options|things|do you (do|offer|provide)|you (do|offer|provide))|\b(services|treatments) (do )?you (offer|do|have|provide)|\b(your|a) (menu|price list|list of services)|what (else )?do you do\b|what can i (book|get)/i,
  describe: /(what('?s| is| are| does)|whats)\s+(a|an|the|your)?\s*\w|tell me (more )?about|explain|what (does|is) .* (involve|include|mean|like)|what happens (in|during|at)|difference between/i,
  price: /(how much|price|prices|cost|costs|charge|expensive|cheap|£|pounds)/i,
  duration: /(how long|duration|take\b|takes\b|minutes|hours? long)/i,
  hours: /(open|opening|close|closing|hours|what time do you|are you in)/i,
  location: /(where|address|located|location|find you|directions|postcode|parking)/i,
  phone: /(phone|number|call you|ring you)/i,
  contact: /(email|website|web site|online)/i,
  book: /(book|appointment|slot|availability|available|come in|get in|space|reserve|schedule|\bfree\b|\btimes\b|anything (on|for|today|tomorrow|this|next))/i,
  reschedule: /(reschedul|move my|change my|push back|different (day|time) for my)/i,
  cancel: /(cancel|can'?t make it)/i,
  yes: /^(yes|yeah|yep|yup|sure|ok(ay)?|please|go ahead|perfect|great|lovely|that works|sounds good|book it|confirm|correct|that'?s right)\b/i,
  no: /^(no|nope|not really|neither|none|nah)\b/i,
  bye: /\b(bye|that'?s all|nothing else|no thanks|that'?s everything)\b|^(thanks|thank you|cheers)[.! ]*$/i,
  thanks: /\b(thanks|thank you|cheers)\b/i,
  // "hi", "heyy", "hiii", "helloo", "yo", "hiya", "hey there", "good morning!", "morning"
  greet: /^(?:h+i+y*a*|he+y+|hel+o+|hallo|yo+|howdy|hiya|greetings|good (?:morning|afternoon|evening)|(?:morning|afternoon|evening))(?:\s+(?:there|again|you|all|guys|mate|love))?[\s!.,]*$/i,
  greetStart: /^(?:h+i+y*a*|he+y+|hel+o+|yo+|hiya|good (?:morning|afternoon|evening))\b[\s!.,]*/i,
  howAreYou: /\b(how (?:are|r) (?:you|u|ya)(?: doing| today)?|how'?s it going|how are things|how do you do|how'?s your day|you (?:ok|alright|good)\??$|what'?s up|wh?at'?s good|wassup|sup\b)/i,
  capabilities: /\b(what (?:do|can) (?:you|u) (?:know|do|help(?: me)? with|tell me)|what can i ask|what are you able|how can you help|what is this|what'?s this|who am i (?:speaking|talking) (?:to|with)|who (?:are|r) (?:you|u)|are (?:you|u) (?:a )?(?:robot|bot|ai|human|real|person|machine|computer)|what are you)\b|^(?:help|menu|options)[?!. ]*$/i,
  ack: /^(?:ok(?:ay)?|k|cool|nice|great|alright|right|hmm+|um+|ah+|oh+|i see|got it|fair enough|lol|haha+|wow|interesting|sure)[\s!.]*$/i,
  offTopic: /\b(weather|joke|football|soccer|cricket|news|politic|recipe|sing (?:me|a)|tell me a story|meaning of life|your favourite|do you like|are you (?:married|single)|bitcoin|crypto|stock|homework|maths?|capital of)\b/i,
};

const T = { agent: 560, tool: 220 };
const say = (text: string): SimEvent => ({ kind: "agent", text, latencyMs: T.agent + Math.min(300, text.length * 2) });
const tool = (name: string, args: Record<string, unknown>, ok: boolean, result: string): SimEvent => ({ kind: "tool", name, args, ok, result, latencyMs: T.tool });

const money = (p: number | null) => (p == null ? null : p === 0 ? "free" : `£${(p / 100).toFixed(p % 100 ? 2 : 0)}`);
const mins = (m: number) => (m < 60 ? `${m} minutes` : m % 60 === 0 ? `${m / 60 === 1 ? "an hour" : `${m / 60} hours`}` : `${Math.floor(m / 60)} hour${m >= 120 ? "s" : ""} ${m % 60} minutes`);
const listOf = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const orList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);
const words = (s: string) => s.toLowerCase().replace(/colour/g, "color").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
const stem = (w: string) => w.replace(/(ings|ing|es|s)$/, "");

/** Services the caller's words point to, best matches first. */
export function matchServices(text: string, services: CatalogService[]): CatalogService[] {
  const t = ` ${words(text).map(stem).join(" ")} `;
  const scored = services.map((s) => {
    const name = words(s.name).map(stem).filter((w) => w.length > 2 && !STOP.has(w));
    const whole = t.includes(` ${words(s.name).map(stem).join(" ")} `);
    const hits = name.filter((w) => t.includes(` ${w} `)).length;
    const cat = s.category && t.includes(` ${stem(words(s.category).join(" "))} `) ? 0.5 : 0;
    return { s, score: whole ? 100 : hits + cat };
  }).filter((x) => x.score > 0);
  const best = Math.max(0, ...scored.map((x) => x.score));
  return scored.filter((x) => x.score === best).map((x) => x.s);
}

function serviceLine(s: CatalogService, withPrice = true): string {
  const p = money(s.pricePence);
  return withPrice && p ? `${s.name} (${p === "free" ? "free" : `from ${p}`})` : s.name;
}

function describe(s: CatalogService): string {
  const p = money(s.pricePence);
  const price = p === "free" ? "and it's free" : p ? `and it starts from ${p}` : "";
  const patch = s.requiresPatchTest ? " You'd need a quick patch test at least 48 hours before." : "";
  return `${s.name} is a ${mins(s.durationMin)} appointment${price ? `, ${price}` : ""}.${patch}`;
}

// ── Dates and times ───────────────────────────────────────────────────────

function localParts(tz: string, d = new Date()) {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "long", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const g = (t: string) => f.find((x) => x.type === t)?.value ?? "";
  return { date: `${g("year")}-${g("month")}-${g("day")}`, weekday: DAYS.indexOf(g("weekday")), minutes: Number(g("hour")) * 60 + Number(g("minute")) };
}
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekdayOf = (iso: string) => (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7;

export interface When { date?: string; after?: number; before?: number; exact?: number }
export function parseWhen(text: string, tz: string, now = new Date()): When {
  const t = text.toLowerCase();
  const today = localParts(tz, now);
  const out: When = {};
  if (/\btoday\b|\bthis (morning|afternoon|evening)\b|\btonight\b/.test(t)) out.date = today.date;
  else if (/\btomorrow\b/.test(t)) out.date = addDays(today.date, 1);
  else {
    const idx = DAYS.findIndex((d) => new RegExp(`\\b${d.toLowerCase()}|\\b${d.slice(0, 3).toLowerCase()}\\b`).test(t));
    if (idx >= 0) out.date = addDays(today.date, (idx - today.weekday + 7) % 7 || 7);
    else if (/next week/.test(t)) out.date = addDays(today.date, (7 - today.weekday) % 7 || 7);
  }
  if (/morning/.test(t)) { out.after = 0; out.before = 12 * 60; }
  if (/afternoon|lunch/.test(t)) { out.after = 12 * 60; out.before = 17 * 60; }
  if (/evening|after work|tonight/.test(t)) { out.after = 17 * 60; }
  const m = t.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|o'?clock)?\b/);
  if (m && (m[2] || m[3]) && Number(m[1]) <= 23) {
    let h = Number(m[1]);
    if (m[3] === "pm" && h < 12) h += 12;
    if (m[3] !== "am" && m[3] !== "pm" && h < 8) h += 12;
    out.exact = h * 60 + Number(m[2] ?? 0);
  }
  return out;
}

const localMinutes = (iso: string, tz: string) => localParts(tz, new Date(iso)).minutes;
const localDate = (iso: string, tz: string) => localParts(tz, new Date(iso)).date;

function slotPhrase(iso: string, tz: string, now = new Date()): string {
  const today = localParts(tz, now).date;
  const d = localDate(iso, tz);
  const day = d === today ? "today" : d === addDays(today, 1) ? "tomorrow" : new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long" }).format(new Date(iso));
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
  return `${day} at ${time}`;
}

function hoursOn(c: Catalog, weekday: number) {
  return c.hours.filter((h) => h.weekday === weekday).sort((a, b) => a.opens.localeCompare(b.opens));
}

function describeWeek(c: Catalog): string {
  if (!c.hours.length) return "";
  const byDay = DAYS.map((_, i) => hoursOn(c, i).map((h) => `${h.opens} to ${h.closes}`).join(" and "));
  const groups: { from: number; to: number; text: string }[] = [];
  byDay.forEach((text, i) => {
    const last = groups[groups.length - 1];
    if (last && last.text === text && last.to === i - 1) last.to = i;
    else groups.push({ from: i, to: i, text });
  });
  return groups.map((g) => `${g.from === g.to ? DAYS[g.from] : `${DAYS[g.from]} to ${DAYS[g.to]}`} ${g.text ? g.text : "closed"}`).join(", ");
}

// ── The receptionist ──────────────────────────────────────────────────────

export async function practiceReply(input: string, state: PracticeState, c: Catalog, findSlots: SlotFinder, now = new Date()): Promise<{ events: SimEvent[]; state: PracticeState }> {
  const s: PracticeState = { ...state, offered: [...state.offered], turn: state.turn + 1, misses: 0 };
  const missedBefore = state.misses ?? 0;
  const ev: SimEvent[] = [];
  const text = input.trim();
  const done = () => ({ events: ev, state: s });
  if (!text) { ev.push(say("Sorry, I didn't quite catch that. Could you say it again?")); return done(); }

  const isQ = RX.question.test(text);
  const matched = matchServices(text, c.services);
  const svc = (id?: string) => c.services.find((x) => x.id === id);
  const bookable = c.services.filter((x) => x.bookable);

  // Safety first.
  if (RX.injection.test(text)) {
    ev.push({ kind: "guardrail", rule: "instruction_override", text: "Caller tried to change the receptionist's instructions. Ignored." });
    ev.push(say(`I can only help with ${c.business} appointments and questions. What can I do for you?`));
    s.node = "guard"; return done();
  }
  if (RX.urgent.test(text)) {
    ev.push({ kind: "guardrail", rule: "urgent_safety", text: "Possible injury or reaction. No medical advice; escalated." });
    ev.push(say("I'm sorry you're going through that. I can't give medical advice, so if it's serious please call 999, or NHS 111 if it's urgent but not an emergency. I'll let the team know straight away so someone can call you back."));
    ev.push(tool("transfer_to_staff", { reason: "possible_reaction", urgent: true }, true, "Team alerted (practice — nobody is actually called)"));
    s.node = "escalate"; return done();
  }

  // Answering an offer to put them through.
  if (s.offeredTransfer) {
    s.offeredTransfer = false;
    if (RX.yes.test(text)) return transfer(s, ev, c, "question the receptionist couldn't answer");
    if (RX.no.test(text)) { ev.push(say("No problem. Is there anything else I can help with?")); return done(); }
  }
  if (RX.frustrated.test(text)) s.frustration++;
  if ((RX.human.test(text) && !RX.book.test(text) && !isQ) || /\b(can|could) i (speak|talk) to\b/i.test(text) || s.frustration >= 2) return transfer(s, ev, c, s.frustration ? "caller frustrated" : "caller asked for a person");
  if (RX.frustrated.test(text)) { ev.push(say("I'm really sorry about that. I'll do my best to sort it out now, or I can put you through to the team. Which would you prefer?")); return done(); }

  // Small talk: a greeting or "how are you" gets a human answer, and anything else in the same
  // message is still handled ("hi, how much is a skin fade?").
  const greeted = RX.greetStart.test(text) || RX.greet.test(text);
  const howAreYou = RX.howAreYou.test(text);
  const rest = text.replace(RX.greetStart, "").replace(RX.howAreYou, "").replace(/^[\s,!.?]+|[\s,!.?]+$/g, "");
  if ((greeted || howAreYou) && (!rest || RX.greet.test(rest) || /^(there|again|mate|you|today)$/i.test(rest))) {
    const hello = s.turn <= 1 ? "Hi there!" : "Hello again!";
    ev.push(say(howAreYou
      ? `${greeted ? `${hello} ` : ""}I'm doing really well, thanks for asking. How can I help you today?`
      : `${hello} ${pick(s, ["What can I help you with today?", "How can I help?", "What can I do for you today?"])}`));
    s.node = "greet"; return done();
  }
  if (rest && (greeted || howAreYou) && rest !== text) {
    // Greeting plus a real request: answer the request, warmly.
    const inner = await practiceReply(rest, { ...s, turn: s.turn - 1 }, c, findSlots, now);
    const first = inner.events.findIndex((e) => e.kind === "agent");
    if (first >= 0) {
      const e = inner.events[first] as Extract<SimEvent, { kind: "agent" }>;
      inner.events[first] = say(`${howAreYou ? "I'm good, thanks for asking! " : "Hi! "}${e.text}`);
    }
    return { events: inner.events, state: { ...inner.state, turn: s.turn } };
  }
  if (RX.offTopic.test(text) && !matched.length && !RX.book.test(text) && !RX.price.test(text) && !RX.hours.test(text)) {
    ev.push(say(`Ha, I wish I could help with that! I'm just the receptionist for ${c.business}, so I'm best with bookings, prices and opening hours. Anything I can help with there?`));
    s.node = "kb"; return done();
  }
  if (RX.capabilities.test(text) && !matched.length && !RX.book.test(text)) {
    ev.push(say(capabilities(c, text))); s.node = "kb"; return done();
  }

  // Questions are answered first, wherever we are in a booking, and the booking picks up after.
  if (isQ || RX.listServices.test(text)) {
    const answered = answerQuestion(text, s, c, matched);
    if (answered) {
      ev.push(...answered.events);
      const follow = resumeLine(s, c);
      const last = ev[ev.length - 1];
      if (follow && last?.kind === "agent") ev[ev.length - 1] = say(`${last.text} ${follow}`);
      return done();
    }
  }

  // Booking in progress.
  if (s.stage === "confirming") {
    if (RX.yes.test(text)) return finalise(s, ev, c, now);
    if (RX.no.test(text)) { s.stage = "need_time"; s.chosen = undefined; s.node = "slots"; ev.push(say("Okay, I won't book that. What day or time would suit you better?")); return done(); }
  }
  if (s.stage === "need_name" && !isQ) {
    const m = text.match(/(?:my name is|i'?m|it'?s|this is|name'?s|call me)\s+([a-z][a-z'-]+(?:\s+[a-z][a-z'-]+)?)/i) ?? (text.split(/\s+/).length <= 3 ? text.match(/^([a-z][a-z'-]+(?:\s+[a-z][a-z'-]+)?)[.!]?$/i) : null);
    if (m && !RX.yes.test(m[1]) && !RX.no.test(m[1])) {
      s.name = m[1].replace(/\b\w/g, (x) => x.toUpperCase());
      s.stage = "confirming"; s.node = "confirm";
      ev.push(say(`Thanks, ${s.name.split(" ")[0]}. So that's ${svc(s.serviceId)!.name.toLowerCase()} ${slotPhrase(s.chosen!, c.timezone, now)}. Shall I book that in for you?`));
      return done();
    }
    ev.push(say("Sorry, could I just take your name for the booking?")); return done();
  }
  if (s.stage === "offered") {
    const pick = pickOffered(text, s.offered, c.timezone, now);
    if (pick) { s.chosen = pick; s.stage = "need_name"; s.node = "details"; ev.push(say(`Great, ${slotPhrase(pick, c.timezone, now)}. And what name shall I put it under?`)); return done(); }
    if (RX.no.test(text)) { s.stage = "need_time"; s.node = "slots"; ev.push(say("That's fine. Is there another day, or a morning or afternoon that works better?")); return done(); }
  }
  if (s.stage === "need_service" && s.choices?.length) {
    const narrowed = matched.filter((m) => s.choices!.includes(m.id));
    const ord = text.match(/\b(first|second|third|fourth|1st|2nd|3rd|4th)\b/i);
    const byOrd = ord ? s.choices[["first", "second", "third", "fourth"].indexOf(ord[1].toLowerCase().replace(/^1st$/, "first").replace(/^2nd$/, "second").replace(/^3rd$/, "third").replace(/^4th$/, "fourth"))] : undefined;
    const pickId = narrowed.length === 1 ? narrowed[0].id : byOrd;
    if (pickId) { s.serviceId = pickId; s.topic = pickId; s.choices = undefined; return askOrOffer(s, ev, c, findSlots, parseWhen(text, c.timezone, now), now); }
  }

  if (RX.cancel.test(text) || RX.reschedule.test(text)) {
    const cancel = RX.cancel.test(text);
    ev.push(tool("find_my_appointments", { phone: "caller ID" }, true, "Practice call: no caller number, so no bookings to look up"));
    ev.push(say(`I can help with that. On a real call I'd find your booking from your number. For now I'll take a message so the team can ${cancel ? "cancel it" : "move it"} for you. What name is the booking under, and when is it?`));
    s.node = "message"; return done();
  }

  // Wanting to book, or naming a service.
  const when = parseWhen(text, c.timezone, now);
  const hasWhen = when.date != null || when.after != null || when.exact != null;
  if (RX.book.test(text) || matched.length || (s.stage === "need_time" && hasWhen) || (s.stage === "need_service" && !isQ)) {
    if (!bookable.length) {
      ev.push(say(`I'm not able to book appointments just yet, but I can take your details and someone from ${c.business} will call you back to arrange it. Would that be okay?`));
      s.node = "message"; return done();
    }
    if (matched.length > 1) {
      s.stage = "need_service"; s.choices = matched.map((m) => m.id); s.node = "book";
      ev.push(say(`Sure. We have a few of those: ${orList(matched.map((m) => serviceLine(m)))}. Which one would you like?`));
      return done();
    }
    if (matched.length === 1) { s.serviceId = matched[0].id; s.topic = matched[0].id; }
    if (!s.serviceId && bookable.length === 1) s.serviceId = bookable[0].id;
    if (!s.serviceId) {
      s.stage = "need_service"; s.node = "book";
      ev.push(say(`Of course. What would you like to book? We do ${orList(bookable.slice(0, 6).map((x) => x.name.toLowerCase()))}${bookable.length > 6 ? ", and a few others" : ""}.`));
      return done();
    }
    return askOrOffer(s, ev, c, findSlots, when, now);
  }

  if (RX.greet.test(text)) { ev.push(say("Hi there! What can I help you with today?")); return done(); }
  if (RX.bye.test(text)) {
    s.stage = "ended"; s.node = "end";
    ev.push(say(`You're welcome. Thanks for calling ${c.business}, have a lovely day!`));
    ev.push({ kind: "state", label: "Call ended (practice)" });
    return done();
  }
  if (RX.yes.test(text) && s.stage === "open") { ev.push(say("Lovely. What can I help you with?")); return done(); }
  if (RX.ack.test(text)) { ev.push(say(s.stage === "open" || s.stage === "booked" ? pick(s, ["Is there anything else I can help with?", "Anything else I can do for you?", "What else can I help with?"]) : resumeLine(s, c) || "What would you like to do next?")); return done(); }
  if (RX.thanks.test(text)) { ev.push(say(`You're very welcome! ${pick(s, ["Is there anything else I can help with?", "Anything else today?"])}`)); return done(); }

  // A real question it can't answer from the workspace: say so and offer a person. Anything
  // else it didn't follow: say so plainly and say what it can do; offer a person the second time.
  if (isQ && !RX.capabilities.test(text)) return dontKnow(s, ev, c, text);
  s.misses = missedBefore + 1;
  if (s.misses >= 2) {
    s.offeredTransfer = c.allowTransfer;
    ev.push(say(c.allowTransfer ? "Sorry, I'm still not quite following. Would you like me to put you through to someone on the team?" : "Sorry, I'm still not quite following. Can I take a message so someone from the team can call you back?"));
    s.node = "fallback"; return done();
  }
  ev.push(say(`Sorry, I didn't quite follow that. I can help with booking an appointment, prices, opening hours or finding us. What would you like to do?`));
  s.node = "clarify";
  return done();
}

/** "Who are you / what do you know / what can you do": who it is and what it can actually help with. */
function capabilities(c: Catalog, text = ""): string {
  const bits: string[] = [];
  if (c.services.length) bits.push(`what we offer and how much it costs, like ${listOf(c.services.slice(0, 3).map((x) => x.name.toLowerCase()))}`);
  if (c.hours.length) bits.push("our opening hours");
  if (c.address) bits.push("where to find us");
  const can = c.services.some((x) => x.bookable) ? "and I can book you in or check what times are free" : "and I can take a message for the team";
  const robot = /\b(robot|bot|ai|human|real|person|machine|computer)\b/i.test(text);
  return `${robot ? `Yes, I'm an AI — ${c.agentName}, the receptionist for ${c.business}. ` : `I'm ${c.agentName}, the AI receptionist for ${c.business}. `}I can tell you ${bits.length ? listOf(bits) : "about the business"}, ${can}. What would you like to know?`;
}

/** Varies short acknowledgements so it doesn't sound scripted. */
const pick = (s: PracticeState, xs: string[]) => xs[s.turn % xs.length];

function answerQuestion(text: string, s: PracticeState, c: Catalog, matched: CatalogService[]): { events: SimEvent[] } | null {
  const ev: SimEvent[] = [];
  const t = text.toLowerCase();
  if (RX.capabilities.test(text) && !matched.length && !RX.listServices.test(text.replace(/\bwhat (?:do|can) you (?:do|help(?: me)? with)\b/i, ""))) {
    ev.push(say(capabilities(c, text))); s.node = "kb"; return { events: ev };
  }
  const topic = matched.length === 1 ? matched[0] : !matched.length ? c.services.find((x) => x.id === (s.serviceId ?? s.topic)) : undefined;
  const refersBack = /\b(it|that|this one|that one)\b/.test(t);

  if (RX.listServices.test(text) && !matched.length) {
    ev.push(tool("list_services", {}, true, `${c.services.length} service(s)`));
    if (!c.services.length) { ev.push(say(`I don't have the service list to hand yet, I'm afraid. I can take a message and someone from ${c.business} will call you back with the details.`)); s.node = "kb"; return { events: ev }; }
    const shown = c.services.slice(0, 8).map((x) => serviceLine(x));
    ev.push(say(`We offer ${listOf(shown)}${c.services.length > 8 ? `, plus ${c.services.length - 8} more` : ""}. Is there one you'd like to know more about, or book?`));
    s.node = "kb"; return { events: ev };
  }

  if (RX.price.test(text)) {
    ev.push(tool("list_services", { query: topic?.name ?? "prices" }, true, topic ? `${topic.name}: ${money(topic.pricePence) ?? "no price set"}` : `${c.services.length} service(s)`));
    if (matched.length > 1) { ev.push(say(`It depends which one. ${listOf(matched.map((m) => serviceLine(m)))}.`)); s.node = "kb"; return { events: ev }; }
    if (topic && (matched.length || refersBack || /\b(much|cost|price)\b/.test(t))) {
      const p = money(topic.pricePence);
      ev.push(say(p ? (p === "free" ? `${topic.name} is free.` : `${topic.name} starts from ${p}. The final price can depend on what you need on the day.`) : `I don't have a price for ${topic.name.toLowerCase()} to hand, and I don't want to guess. The team can confirm it for you.`));
      s.topic = topic.id; s.node = "kb"; return { events: ev };
    }
    const priced = c.services.filter((x) => x.pricePence != null);
    if (!priced.length) { ev.push(say("I don't have prices to hand, and I'd rather not guess. I can ask someone from the team to call you back with a quote.")); s.node = "kb"; return { events: ev }; }
    ev.push(say(`Here are our starting prices: ${listOf(priced.slice(0, 8).map((x) => serviceLine(x)))}. Which one were you thinking of?`));
    s.node = "kb"; return { events: ev };
  }

  if (RX.duration.test(text) && (topic || matched.length)) {
    if (matched.length > 1) { ev.push(say(listOf(matched.map((m) => `${m.name} takes about ${mins(m.durationMin)}`)) + ".")); s.node = "kb"; return { events: ev }; }
    ev.push(say(`${topic!.name} takes about ${mins(topic!.durationMin)}.`)); s.topic = topic!.id; s.node = "kb"; return { events: ev };
  }

  if (RX.describe.test(text) && matched.length && !RX.hours.test(text)) {
    ev.push(tool("list_services", { query: matched.map((m) => m.name).join(", ") }, true, matched.map((m) => m.name).join("; ")));
    ev.push(say(matched.length > 1 ? `We have ${matched.length}: ${matched.map(describe).join(" ")}` : describe(matched[0])));
    if (matched.length === 1) s.topic = matched[0].id;
    s.node = "kb"; return { events: ev };
  }

  // "Do you do X?" — answer yes with details, or say plainly that it isn't on the list.
  const doYou = t.match(/\b(?:do|can) you (?:do|offer|have|provide)\s+(.+?)[?.!]*$/);
  const w = parseWhen(text, c.timezone);
  if (doYou && !RX.listServices.test(text) && !RX.book.test(text) && w.date == null && w.after == null && w.exact == null) {
    ev.push(tool("list_services", { query: doYou[1] }, true, matched.length ? matched.map((m) => m.name).join("; ") : "No matching service"));
    if (matched.length) ev.push(say(`Yes, we do. ${matched.map(describe).join(" ")}`));
    else ev.push(say(`I don't see ${doYou[1].replace(/^(any|a|an)\s+/, "")} on our list, I'm afraid. We do ${orList(c.services.slice(0, 5).map((x) => x.name.toLowerCase()))}. If you'd like, I can check with the team for you.`));
    if (matched.length === 1) s.topic = matched[0].id;
    s.node = "kb"; return { events: ev };
  }

  if (RX.hours.test(text)) {
    ev.push(tool("get_opening_hours", {}, true, c.hours.length ? `${c.hours.length} interval(s)` : "No opening hours set"));
    if (!c.hours.length) { ev.push(say("I don't have our opening hours to hand, sorry. I can take a message and someone will get back to you.")); s.node = "kb"; return { events: ev }; }
    const when = parseWhen(text, c.timezone);
    if (when.date) {
      const wd = weekdayOf(when.date);
      const h = hoursOn(c, wd);
      ev.push(say(h.length ? `On ${DAYS[wd]} we're open ${h.map((x) => `${x.opens} to ${x.closes}`).join(" and ")}.` : `We're closed on ${DAYS[wd]}s, I'm afraid.`));
    } else if (/\b(now|right now|at the moment|still)\b/.test(t)) {
      const p = localParts(c.timezone);
      const open = hoursOn(c, p.weekday).find((x) => toMin(x.opens) <= p.minutes && p.minutes < toMin(x.closes));
      ev.push(say(open ? `Yes, we're open now until ${open.closes}.` : `We're closed right now. Our hours are ${describeWeek(c)}.`));
    } else ev.push(say(`We're open ${describeWeek(c)}.`));
    s.node = "kb"; return { events: ev };
  }

  if (RX.location.test(text)) {
    ev.push(tool("get_business_info", { field: "address" }, true, c.address ? "address on file" : "No address set"));
    ev.push(say(c.address ? `We're at ${c.address}.${/parking/.test(t) ? " I don't have parking details to hand, but the team can tell you." : ""}` : "I don't have our address to hand, sorry. I can ask someone from the team to send it to you."));
    s.node = "kb"; return { events: ev };
  }
  if (RX.phone.test(text) && !RX.book.test(text)) {
    ev.push(tool("get_business_info", { field: "phone" }, true, c.phone ? "phone on file" : "No phone set"));
    ev.push(say(c.phone ? `You can reach us on ${c.phone.replace(/(\d)(?=(\d{3})+$)/g, "$1 ")}.` : "I don't have a direct number to give you, but I can take a message for the team."));
    s.node = "kb"; return { events: ev };
  }
  if (RX.contact.test(text)) {
    ev.push(tool("get_business_info", { field: "contact" }, true, c.email || c.website ? "contact details on file" : "No email or website set"));
    const bits = [c.email && `email us at ${c.email}`, c.website && `visit ${c.website.replace(/^https?:\/\//, "")}`].filter(Boolean) as string[];
    ev.push(say(bits.length ? `You can ${orList(bits)}.` : "I don't have an email or website to give you, but I can take a message for the team."));
    s.node = "kb"; return { events: ev };
  }
  if (/\b(what|who) (is|are) (you|this)\b|what do you do\b|tell me about (the|your) (business|salon|shop|clinic|place)/i.test(text)) {
    ev.push(say(`${c.business}${c.description ? `: ${c.description}` : ""}. I'm ${c.agentName}, the AI receptionist. I can answer questions, book appointments, or put you through to the team.`));
    s.node = "kb"; return { events: ev };
  }
  if (RX.describe.test(text) && !matched.length && s.stage !== "open" && refersBack && topic) {
    ev.push(say(describe(topic))); s.node = "kb"; return { events: ev };
  }
  return null;
}

/** After answering a side question mid-booking, gently pick the booking back up. */
function resumeLine(s: PracticeState, c: Catalog): string {
  const name = c.services.find((x) => x.id === s.serviceId)?.name.toLowerCase();
  switch (s.stage) {
    case "need_service": return s.choices?.length ? "Which one would you like?" : "";
    case "need_time": return name ? `Shall I look for a time for your ${name}?` : "";
    case "offered": return "Would any of the times I mentioned work for you?";
    case "need_name": return "And what name shall I put the booking under?";
    case "confirming": return "Shall I go ahead and book it?";
    default: return s.topic && c.services.find((x) => x.id === s.topic)?.bookable && s.stage === "open" ? "Would you like me to book you in?" : "";
  }
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

async function askOrOffer(s: PracticeState, ev: SimEvent[], c: Catalog, findSlots: SlotFinder, when: When, now: Date) {
  const x = c.services.find((v) => v.id === s.serviceId)!;
  if (!x.bookable) {
    ev.push({ kind: "guardrail", rule: "service_not_agent_bookable", text: `${x.name} is arranged by staff.` });
    ev.push(say(`${x.name} is something the team likes to arrange personally. I'll take a message and someone will call you back to set it up. Can I take your name?`));
    s.node = "message"; return { events: ev, state: s };
  }
  const hasWhen = when.date != null || when.after != null || when.exact != null;
  if (!hasWhen && s.stage !== "need_time") {
    s.stage = "need_time"; s.node = "slots";
    ev.push(say(`Lovely, ${x.name.toLowerCase()}. Do you have a day or time in mind, or shall I find the next one available?`));
    return { events: ev, state: s };
  }
  let slots: string[] = [];
  try {
    slots = await findSlots(x.id, when.date);
  } catch (e) {
    ev.push(tool("check_availability", { service: x.name, on: when.date ?? "next available" }, false, e instanceof Error ? e.message : "availability unavailable"));
    ev.push(say("I'm sorry, I can't see the diary right now, and I don't want to guess. Can I take your name so the team can call you back to book?"));
    s.node = "message"; return { events: ev, state: s };
  }
  const tz = c.timezone;
  const fits = slots.filter((iso) => {
    const m = localMinutes(iso, tz);
    if (when.exact != null) return Math.abs(m - when.exact) <= 60;
    return (when.after == null || m >= when.after) && (when.before == null || m < when.before);
  });
  const pickFrom = fits.length ? fits : slots;
  const exactHit = when.exact != null ? pickFrom.find((iso) => localMinutes(iso, tz) === when.exact) : undefined;
  const offer = exactHit ? [exactHit] : spread(pickFrom, 3);
  ev.push(tool("check_availability", { service: x.name, on: when.date ?? "next available" }, true, slots.length ? `${slots.length} time(s) free` : "Nothing free"));
  if (!offer.length) {
    s.stage = "need_time"; s.node = "slots";
    ev.push(say(when.date ? `I'm afraid we're fully booked for ${x.name.toLowerCase()} that day. Would another day work?` : `I can't see anything free for ${x.name.toLowerCase()} in the next couple of weeks. I can take your details and the team will call if something opens up.`));
    return { events: ev, state: s };
  }
  s.offered = offer; s.stage = "offered"; s.node = "slots";
  const phrases = offer.map((o) => slotPhrase(o, tz, now));
  const lead = exactHit ? `Yes, ${phrases[0]} is free.` : !fits.length && hasWhen ? `That time's taken, but I could do ${orList(phrases)}.` : offer.length === 1 ? `The next one I have is ${phrases[0]}.` : `I could do ${orList(phrases)}.`;
  ev.push(say(`${lead} ${exactHit ? "Shall I take that one?" : offer.length === 1 ? "Would that work?" : "Which suits you best?"}`));
  return { events: ev, state: s };
}

function spread(xs: string[], n: number): string[] {
  if (xs.length <= n) return xs;
  return Array.from({ length: n }, (_, i) => xs[Math.round((i * (xs.length - 1)) / (n - 1))]);
}

function pickOffered(text: string, offered: string[], tz: string, now: Date): string | undefined {
  const t = text.toLowerCase();
  const ord = [/\b(first|1st|earlie(r|st))\b/, /\b(second|2nd|middle)\b/, /\b(third|3rd|last|later|latest)\b/];
  for (let i = 0; i < ord.length; i++) if (ord[i].test(t) && offered[i]) return i === 2 && /\blast\b/.test(t) ? offered[offered.length - 1] : offered[i];
  const w = parseWhen(t, tz, now);
  if (w.exact != null) { const hit = offered.find((o) => Math.abs(localMinutes(o, tz) - w.exact!) <= 15); if (hit) return hit; }
  if (w.date) { const same = offered.filter((o) => localDate(o, tz) === w.date); if (same.length === 1) return same[0]; }
  if (offered.length === 1 && RX.yes.test(t)) return offered[0];
  if (RX.yes.test(t) && /\b(any|either|whichever|first one)\b/.test(t)) return offered[0];
  return undefined;
}

function finalise(s: PracticeState, ev: SimEvent[], c: Catalog, now: Date) {
  const x = c.services.find((v) => v.id === s.serviceId)!;
  ev.push(tool("book_appointment", { service: x.name, starts_at: s.chosen, customer_name: s.name, caller_confirmed: true }, true, "Practice mode: not written to your real diary"));
  s.stage = "booked"; s.node = "booked";
  ev.push(say(`Lovely, you're booked in for ${x.name.toLowerCase()} ${slotPhrase(s.chosen!, c.timezone, now)}.${x.requiresPatchTest ? " The team will be in touch about your patch test." : ""} Is there anything else I can help with?`));
  ev.push({ kind: "state", label: "Practice booking: nothing was added to your diary" });
  return { events: ev, state: s };
}

function transfer(s: PracticeState, ev: SimEvent[], c: Catalog, reason: string) {
  if (!c.allowTransfer) {
    ev.push(say("Everyone's busy at the moment, but I'll take a message and someone will call you back. What's your name, and what's it about?"));
    ev.push(tool("take_message", { reason }, true, "Practice: message not saved"));
    s.node = "message"; return { events: ev, state: s };
  }
  ev.push(say(s.frustration ? "I'm really sorry. Let me get you to someone on the team right now. One moment, and I'll let them know what's happened." : "Of course. I'll put you through to someone on the team now. One moment, and I'll pass on what you've told me."));
  ev.push(tool("transfer_to_staff", { reason, stage: s.stage }, true, "Practice: no real call placed. On a live call this goes to the least-busy available team member"));
  s.stage = "transferred"; s.node = "transfer";
  return { events: ev, state: s };
}

function dontKnow(s: PracticeState, ev: SimEvent[], c: Catalog, text: string) {
  ev.push(tool("search_knowledge", { query: text.slice(0, 60) }, false, "Nothing in this workspace's details answers that"));
  ev.push({ kind: "guardrail", rule: "unsupported_answer", text: "Not in the workspace's details. The receptionist doesn't guess." });
  s.offeredTransfer = c.allowTransfer;
  ev.push(say(c.allowTransfer ? "That's a good question, and I don't want to give you the wrong answer. Would you like me to put you through to someone on the team who can help?" : "That's a good question, and I don't want to give you the wrong answer. Can I take a message so someone from the team can get back to you?"));
  s.node = "fallback";
  return { events: ev, state: s };
}

/** "Hi, you're through to …" from the saved agent greeting, plus the recording notice. */
export function practiceGreeting(c: Catalog, greeting: string | null, recording: string | null): SimEvent[] {
  const g = (greeting || `Hi, thanks for calling {business}. I'm {agent}, the AI receptionist. How can I help?`).replace("{business}", c.business).replace("{agent}", c.agentName);
  return [{ kind: "state", label: `Practice call · ${c.business} · real workspace details` }, say(recording ? `${g} ${recording}` : g)];
}
