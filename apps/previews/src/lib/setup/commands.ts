// "Just tell it what you want": turns an owner's request about their saved setup ("skin fade
// is now £25", "we're closed on Mondays now", "our new number is 0117 496 0123", "put all
// prices up £2") into exact changes, a plain before → after summary, and the changes that
// would undo it. Works at any point, during setup or long after. Pure: the UI performs the
// changes against the API. When a request could mean two things it asks instead of guessing.

import type { Agent, BusinessProfile, HoursInterval, Service, WorkspaceSettings } from "../live/api";
import { findService, key } from "./match";
import { closedWeek, DAY_NAMES, describeDay, parseAddress, parseCount, parseDays, parseHours, parsePhone, parseServices, type Week } from "./parse";
import { templateFor } from "./templates";

export interface SavedService { name: string; duration_min: number; price_from_pence: number | null; category: string | null; buffer_min: number; requires_patch_test: boolean }
export interface Saved {
  businessName: string;
  week: Week;
  services: SavedService[];
  phone: string | null;
  address_line1: string | null;
  city: string | null;
  postcode: string | null;
  description: string | null;
  capacity: number;
  receptionist: { name: string; greeting: string } | null;
}

export type ServicePatch = Partial<Pick<SavedService, "name" | "duration_min" | "price_from_pence" | "category">>;
export type ProfilePatch = Partial<Pick<Saved, "phone" | "address_line1" | "city" | "postcode" | "description">>;
export type Change =
  | { kind: "hours"; week: Week }
  | { kind: "service_update"; name: string; patch: ServicePatch }
  | { kind: "service_remove"; names: string[] }
  | { kind: "service_add"; services: SavedService[] }
  | { kind: "profile"; patch: ProfilePatch }
  | { kind: "capacity"; capacity: number }
  | { kind: "receptionist"; patch: { name?: string; greeting?: string } };

export type Topic = "hours" | "services" | "phone" | "address" | "capacity" | "receptionist" | "policies";
export interface Plan { topic: Topic; changes: Change[]; undo: Change[]; done: string[]; notes: string[] }
export type Interpretation = { plan: Plan } | { topic: Topic; ask: string } | null;

/** The workspace as the API returns it, in the shape requests are read against. */
export function savedFrom(s: { profile: BusinessProfile; hours: HoursInterval[]; services: Service[]; agents: Agent[]; settings: WorkspaceSettings | null }): Saved {
  const week = closedWeek();
  for (const h of s.hours) week[h.weekday].push({ opens: h.opens_at.slice(0, 5), closes: h.closes_at.slice(0, 5) });
  week.forEach((d) => d.sort((a, b) => a.opens.localeCompare(b.opens)));
  const a = s.agents[0];
  return {
    businessName: s.profile.display_name, week,
    services: s.services.filter((x) => x.active).map((x) => ({ name: x.name, duration_min: x.duration_min, price_from_pence: x.price_from_pence, category: x.category, buffer_min: x.buffer_min, requires_patch_test: x.requires_patch_test })),
    phone: s.profile.phone, address_line1: s.profile.address_line1, city: s.profile.city, postcode: s.profile.postcode, description: s.profile.description,
    capacity: s.settings?.booking_capacity ?? 1, receptionist: a ? { name: a.name, greeting: a.greeting } : null,
  };
}

const gbp = (p: number | null) => (p === null ? "no price" : p === 0 ? "free" : `£${(p / 100).toFixed(p % 100 ? 2 : 0)}`);
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const sentence = (s: string) => { const t = s.trim().replace(/^["“]|["”]$/g, ""); return t ? t[0].toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? "" : ".") : t; };
const plan = (topic: Topic, changes: Change[], undo: Change[], done: string[], notes: string[] = []): Interpretation => ({ plan: { topic, changes, undo, done, notes } });

/** Polite wrappers and time words that don't change what's being asked. */
function clean(text: string): string {
  let t = text.trim();
  const lead = /^\s*(?:(?:hi|hey|hello|ok|okay|right|so|um+|oh|also|and|actually|sorry)[,!.\s]+|(?:can|could|would|will) you(?: please)?\s+|please\s+|i(?:'d| would) like (?:you )?to\s+|i (?:want|need) (?:you )?to\s+|we (?:want|need) to\s+|let'?s\s+|go ahead and\s+|just\s+)/i;
  while (lead.test(t)) t = t.replace(lead, "");
  return t.replace(/[\s,]+(?:please|thanks|thank you|cheers|ta|for me)[.!]*\s*$/i, "").replace(/[.!]+\s*$/, "").trim();
}
const NOWISH = /\b(?:from now on|going forward|from today|these days|now|anymore|any more|instead|actually)\b/gi;
const calm = (t: string) => t.replace(NOWISH, " ").replace(/\s+/g, " ").trim();

const POLICY = /^(?:add (?:a |this |the )?(?:note|policy|line|rule)(?: to (?:the |my |our )?(?:description|policies|notes))?|tell (?:callers|customers|people|clients|everyone)|let (?:callers|customers|people|clients) know|make sure (?:callers|customers|clients|the receptionist) (?:know|knows)|the receptionist should (?:say|tell (?:callers|people|customers)))\s*(?:that\b|:|-)?\s*(.+)$/is;
const RECEPTIONIST = /\b(receptionist|assistant|greeting|the ai)\b/i;
const RENAME_AGENT = [
  /\b(?:rename|call|name)\s+(?:the |my |our )?(?:receptionist|assistant|ai)\s+(?:to\s+|as\s+)?["“]?([\p{L}][\p{L}' -]{0,38})["”]?$/iu,
  /\b(?:receptionist|assistant|ai)(?:['’]s)?(?: name)?\s+(?:should be called|is called|to be called|is now called|should be|is now|to)\s+["“]?([\p{L}][\p{L}' -]{0,38})["”]?$/iu,
  /\bchange (?:the |my |our )?(?:receptionist|assistant|ai)(?:['’]s)? name to\s+["“]?([\p{L}][\p{L}' -]{0,38})["”]?$/iu,
];
const GREETING = /\bgreeting\s*(?:to|:|should be|should say|to say|=)\s*["“]?(.+?)["”]?$/is;
const PHONE_CUE = /\b(phone|number|mobile|landline|tel|call us)\b/i;
const ADDRESS_CUE = /\b(moved|moving|relocat\w*|address|premises|postcode|new (?:shop|location|place|unit)|we'?re (?:now )?(?:at|based at|located at))\b/i;
const CAPACITY_CUE = /\b(capacity|chairs?|barbers?|stylists?|therapists?|staff|employees?|people working|team of|at (?:the same|a|one) time|at once|rooms?|bays?|tables?)\b/i;
const REMOVE = /^(?:remove|delete|drop|take (?:off|out)|get rid of|scrap|cross off|stop (?:offering|doing|selling)|we (?:no longer|don'?t|do not|won'?t) (?:do|offer|sell|provide)|no more|we'?ve stopped (?:doing|offering)?)\s+(?:the\s+)?(.+)$/i;
const ADD = /^(?:add|we (?:also |now )?(?:do|offer|sell|provide)|we'?ve started (?:doing|offering)|start offering|new service:?|include)\s+(.+)$/is;
const BULK = /\b(?:all|every|each|everything)\b/i;
const HOURS_CUE = /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b|\b(week ?days?|week ?ends?|every ?day|daily|open|opens|opening|close|closes|closed|closing|shut|hours|till|until|late|early|24\/7)\b/i;

function receptionist(t: string, saved: Saved): Interpretation {
  const r = saved.receptionist;
  if (!r) return { topic: "receptionist", ask: "You don't have a receptionist yet — what would you like it to be called?" };
  const g = t.match(GREETING);
  if (g) {
    let greeting = sentence(g[1]);
    const notes: string[] = [];
    if (!/\b(AI|automated|virtual assistant)\b/i.test(greeting)) { greeting = `${greeting} I'm ${r.name}, the AI receptionist.`; notes.push("UK rules mean callers must be told they're speaking to an AI, so I added that to the end."); }
    if (greeting.length > 500) return { topic: "receptionist", ask: "That greeting is a bit long — please keep it under 500 characters." };
    return plan("receptionist", [{ kind: "receptionist", patch: { greeting } }], [{ kind: "receptionist", patch: { greeting: r.greeting } }], [`Greeting: “${greeting}”`], notes);
  }
  const m = RENAME_AGENT.map((re) => t.match(re)).find(Boolean);
  if (!m) return null;
  const name = m[1].trim().replace(/(^|[\s-])(\p{L})/gu, (_, b, c) => b + c.toUpperCase());
  if (name.toLowerCase() === r.name.toLowerCase()) return { topic: "receptionist", ask: `Your receptionist is already called ${r.name}.` };
  const greeting = r.greeting.split(r.name).join(name);
  return plan("receptionist", [{ kind: "receptionist", patch: { name, greeting } }], [{ kind: "receptionist", patch: { name: r.name, greeting: r.greeting } }],
    [`Receptionist: ${r.name} → ${name}`, ...(greeting !== r.greeting ? [`Greeting: “${greeting}”`] : [])]);
}

function capacity(t: string, saved: Saved): Interpretation {
  if (/£|\b\d+\s*(?:m|min|mins|minutes|h|hr|hrs|hours?)\b/i.test(t)) return null;
  let n: number | null = null;
  if (/\b(another|one more|an extra|extra|a new|hired|taken on)\b/i.test(t) && !/\d/.test(t)) n = saved.capacity + 1;
  else if (/\b(one less|one fewer|lost (?:a|one)|(?:a|one) (?:\w+ )?(?:left|leaving|quit))\b/i.test(t) && !/\d/.test(t)) n = saved.capacity - 1;
  else n = parseCount(t);
  if (n === null) return null;
  if (n < 1 || n > 50) return { topic: "capacity", ask: "Capacity needs to be between 1 and 50 — how many customers can be seen at the same time?" };
  if (n === saved.capacity) return { topic: "capacity", ask: `It's already set to ${n} at a time.` };
  return plan("capacity", [{ kind: "capacity", capacity: n }], [{ kind: "capacity", capacity: saved.capacity }], [`Customers at the same time: ${saved.capacity} → ${n}`]);
}

/** Splits "head shave, perm or texturising and beard colour" into the services it names. */
function targets(text: string, services: SavedService[]): { hits: number[]; missing: string[]; ambiguous: string[] } {
  const hits: number[] = [], missing: string[] = [], ambiguous: string[] = [];
  const walk = (s: string, seps: RegExp[]) => {
    const f = findService(s, services);
    if (f.length === 1) { if (!hits.includes(f[0])) hits.push(f[0]); return; }
    if (seps.length) { s.split(seps[0]).filter(Boolean).forEach((x) => walk(x.trim(), seps.slice(1))); return; }
    if (f.length > 1) ambiguous.push(`“${s}” could be ${list(f.map((i) => services[i].name))}`);
    else missing.push(s);
  };
  walk(text.replace(/^(?:the|our|my)\s+/i, ""), [/\s*,\s*/, /\s+(?:and|&)\s+/i, /\s+or\s+/i]);
  return { hits, missing, ambiguous };
}

function bulkPrices(t: string, saved: Saved): Interpretation {
  const up = /\b(up|increase|raise|rise|more|higher|add)\b/i.test(t), down = /\b(down|decrease|lower|reduce|cut|less|off|discount)\b/i.test(t);
  const pounds = t.match(/£\s*(\d+(?:\.\d{1,2})?)/), pct = t.match(/(\d+(?:\.\d+)?)\s*(?:%|per ?cent)/i);
  if ((!pounds && !pct) || up === down) return null;
  // "all haircuts up £2": only that category, when one matches.
  const cats = [...new Set(saved.services.map((s) => s.category).filter((c): c is string => !!c))];
  const cat = cats.find((c) => ` ${key(t)} `.includes(` ${key(c)} `));
  const scope = saved.services.filter((s) => s.price_from_pence !== null && s.price_from_pence > 0 && (!cat || s.category === cat));
  if (!scope.length) return { topic: "services", ask: "None of your services have a price yet, so there's nothing to change." };
  const sign = up ? 1 : -1;
  const priced = scope.map((s) => {
    const p = s.price_from_pence!;
    const next = pounds ? p + sign * Math.round(Number(pounds[1]) * 100) : Math.round((p * (1 + (sign * Number(pct![1])) / 100)) / 10) * 10;
    return { s, next: Math.max(0, next) };
  });
  const by = pounds ? `£${pounds[1]}` : `${pct![1]}%`;
  return plan("services",
    priced.map(({ s, next }) => ({ kind: "service_update", name: s.name, patch: { price_from_pence: next } }) as Change),
    priced.map(({ s }) => ({ kind: "service_update", name: s.name, patch: { price_from_pence: s.price_from_pence } }) as Change),
    [`${cat ? `${cat} prices` : "All prices"} ${up ? "up" : "down"} ${by} (${priced.length} service${priced.length === 1 ? "" : "s"}):`, ...priced.map(({ s, next }) => `  ${s.name}: ${gbp(s.price_from_pence)} → ${gbp(next)}`)],
    pct ? ["Percentage changes are rounded to the nearest 10p."] : []);
}

const OPEN_CLOSE_AT = /\b(open|opens|opening|start|starts|close|closes|closing|shut|shuts|finish|finishes)\s+(?:at|from|by)?\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\b(?!\s*(?:-|–|to|till|until)\s*\d)/i;

/** "we close at 6 on Wednesdays", "open at 10 on Saturdays": moves one end of those days. */
function openCloseAt(t: string, saved: Saved): Interpretation {
  const m = t.match(OPEN_CLOSE_AT);
  if (!m) return null;
  const opening = /^(open|start)/i.test(m[1]);
  // "every day" here means every day you're open, not reopening closed days.
  const days = /\b(every ?day|daily|always|all week|each day)\b/i.test(t) ? [0, 1, 2, 3, 4, 5, 6].filter((d) => saved.week[d].length) : parseDays(t);
  if (!days.length) return { topic: "hours", ask: `Which days do you ${opening ? "open" : "close"} at ${m[2]}${m[3] ? ":" + m[3] : ""}${m[4] ?? ""}? e.g. “Saturdays” or “every day”.` };
  const closed = days.filter((d) => !saved.week[d].length);
  if (closed.length) return { topic: "hours", ask: `You're closed on ${list(closed.map((d) => DAY_NAMES[d]))} at the moment — what are the full hours? e.g. “${DAY_NAMES[closed[0]]} 9–6”.` };
  let h = Number(m[2]);
  const mins = Number(m[3] ?? 0);
  if (m[4]?.toLowerCase() === "pm" && h < 12) h += 12;
  else if (m[4]?.toLowerCase() === "am" && h === 12) h = 0;
  else if (!m[4] && (opening ? h < 7 : h < 12)) h += 12; // "open at 1" is 1pm; "close at 6" is 6pm
  if (h > 23 || mins > 59) return null;
  const time = `${String(h).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
  const week = saved.week.map((d) => d.map((p) => ({ ...p })));
  for (const d of days) {
    const ps = week[d];
    if (opening) ps[0].opens = time; else ps[ps.length - 1].closes = time;
    if (ps.some((p) => p.opens >= p.closes)) return { topic: "hours", ask: `That would ${opening ? "open after closing" : "close before opening"} on ${DAY_NAMES[d]} (${describeDay(saved.week[d])}). What are the full hours? e.g. “${DAY_NAMES[d]} 9–6”.` };
  }
  const changed = days.filter((d) => describeDay(week[d]) !== describeDay(saved.week[d]));
  if (!changed.length) return { topic: "hours", ask: `That's already how your hours are: ${days.map((d) => `${DAY_NAMES[d]} ${describeDay(saved.week[d])}`).join(", ")}.` };
  return plan("hours", [{ kind: "hours", week }], [{ kind: "hours", week: saved.week }], changed.map((d) => `${DAY_NAMES[d]}: ${describeDay(saved.week[d])} → ${describeDay(week[d])}`));
}

function hours(t: string, saved: Saved): Interpretation {
  const at = openCloseAt(t, saved);
  if (at) return at;
  const body = t
    .replace(/\b(?:don'?t|do not|won'?t|will not|no longer|never)\s+(?:be\s+)?(?:open|work|trade|opening)\b/gi, "closed")
    .replace(/^(?:change|make|set|update|move)\s+(?:the\s+|our\s+|my\s+)?(?:(?:opening\s+)?hours\s+(?:on|for)\s+)?/i, "")
    .replace(/\b(?:we(?:'re| are| will be|'ll be)|our (?:opening )?hours (?:on \w+ )?(?:are|will be)|open(?:ing)? (?:hours )?(?:on|for)?)\b/gi, " ")
    .replace(/\b(?:to|at)\s+(?=\d)/gi, "")
    .replace(/\b(?:open|opening)\s+(?=closed)/gi, "");
  const r = parseHours(calm(body), saved.week);
  if (!r.understood || !r.touched.length) {
    const lateOnClosed = /\b(?:till|until|late)\b/i.test(t) ? parseDays(t).find((d) => !saved.week[d].length) : undefined;
    if (lateOnClosed !== undefined) return { topic: "hours", ask: `You're closed on ${DAY_NAMES[lateOnClosed]}s at the moment — what time would you open and close? e.g. “${DAY_NAMES[lateOnClosed]} 9–8”.` };
    return null;
  }
  const changed = r.touched.filter((d) => describeDay(r.week[d]) !== describeDay(saved.week[d]));
  if (!changed.length) return { topic: "hours", ask: `That's already how your hours are: ${r.touched.map((d) => `${DAY_NAMES[d]} ${describeDay(saved.week[d])}`).join(", ")}.` };
  const notes = [...r.assumptions.filter((a) => !/read the times/.test(a)), ...(r.unparsed.length ? [`I couldn't use: “${r.unparsed.join("”, “")}”.`] : [])];
  return plan("hours", [{ kind: "hours", week: r.week }], [{ kind: "hours", week: saved.week }],
    changed.map((d) => `${DAY_NAMES[d]}: ${describeDay(saved.week[d])} → ${describeDay(r.week[d])}`), notes);
}

function addServices(text: string, saved: Saved, sector: string | null | undefined): Interpretation {
  const { services, unparsed } = parseServices(text);
  if (!services.length) return { topic: "services", ask: `I couldn't read a service in “${text}”. Try “add beard dye 20 min £15”.` };
  const tpl = templateFor(sector);
  const fresh: SavedService[] = [], updates: Change[] = [], undo: Change[] = [], done: string[] = [], notes: string[] = [];
  for (const s of services) {
    const same = saved.services.find((x) => key(x.name) === key(s.name));
    if (same) {
      const patch: ServicePatch = { ...(s.duration_min !== null ? { duration_min: s.duration_min } : {}), ...(s.price_from_pence !== null ? { price_from_pence: s.price_from_pence } : {}) };
      if (Object.keys(patch).length) { updates.push({ kind: "service_update", name: same.name, patch }); undo.push({ kind: "service_update", name: same.name, patch: { duration_min: same.duration_min, price_from_pence: same.price_from_pence } }); done.push(`${same.name} was already there — updated it`); }
      else notes.push(`${same.name} is already in your services.`);
      continue;
    }
    const t = tpl ? findService(s.name, tpl.services) : [];
    const typical = t.length === 1 ? tpl!.services[t[0]] : null;
    const duration = s.duration_min ?? typical?.duration_min ?? 30;
    if (s.duration_min === null) notes.push(`${s.name}: no length given, so I used ${duration} minutes${typical ? ` (typical for ${tpl!.label.toLowerCase()}s)` : ""} — say “${s.name} 20 min” to change it.`);
    notes.push(...s.notes.map((n) => `${s.name}: ${n}`));
    fresh.push({ name: s.name, duration_min: duration, price_from_pence: s.price_from_pence, category: s.category ?? typical?.category ?? null, buffer_min: typical?.buffer_min ?? 0, requires_patch_test: s.requires_patch_test });
    done.push(`Added ${s.name} — ${duration} min, ${s.price_from_pence === null ? "no price" : `from ${gbp(s.price_from_pence)}`}`);
  }
  if (unparsed.length) notes.push(`I couldn't use: “${unparsed.join("”, “")}”.`);
  if (!fresh.length && !updates.length) return { topic: "services", ask: notes.join(" ") || "Nothing to add." };
  return plan("services", [...(fresh.length ? [{ kind: "service_add", services: fresh } as Change] : []), ...updates],
    [...(fresh.length ? [{ kind: "service_remove", names: fresh.map((s) => s.name) } as Change] : []), ...undo], done, notes);
}

function updateServices(t: string, saved: Saved): Interpretation {
  const ren = t.match(/^rename\s+(?:the\s+)?(.+?)\s+(?:to|as)\s+["“]?(.+?)["”]?$/i) ?? t.match(/^(?:change|call)\s+(?:the\s+)?(.+?)(?:['’]s)?\s+(?:name\s+)?to\s+(?:be\s+called\s+)?["“]([^"”]+)["”]$/i);
  if (ren) {
    const f = findService(ren[1], saved.services);
    if (f.length === 1) {
      const s = saved.services[f[0]];
      const name = ren[2].trim()[0].toUpperCase() + ren[2].trim().slice(1);
      if (saved.services.some((x, i) => i !== f[0] && key(x.name) === key(name))) return { topic: "services", ask: `You already have a service called ${name}.` };
      return plan("services", [{ kind: "service_update", name: s.name, patch: { name } }], [{ kind: "service_update", name, patch: { name: s.name } }], [`Renamed ${s.name} → ${name}`]);
    }
    if (f.length > 1) return { topic: "services", ask: `“${ren[1]}” could be ${list(f.map((i) => saved.services[i].name))} — which one?` };
  }
  const body = calm(t)
    .replace(/^(?:change|make|set|update|put|move|correct)\s+/i, "")
    .replace(/\b(?:the\s+)?(?:price|cost|length|time|duration)\s+(?:of|for)\s+(?:the\s+|a\s+)?/gi, "")
    .replace(/\b(?:costs?|is|are|takes|should (?:be|cost|take)|will be|goes up to|goes down to)\b/gi, " ");
  const { services } = parseServices(body);
  const wanted = services.filter((s) => s.duration_min !== null || s.price_from_pence !== null);
  if (!wanted.length) return null;
  const changes: Change[] = [], undo: Change[] = [], done: string[] = [], asks: string[] = [];
  for (const s of wanted) {
    const f = findService(s.name, saved.services);
    if (f.length > 1) { asks.push(`“${s.name}” could be ${list(f.map((i) => saved.services[i].name))} — which one?`); continue; }
    if (!f.length) { asks.push(`I can't find “${s.name}” in your services. To add it, say “add ${s.name}${s.duration_min ? ` ${s.duration_min} min` : ""}${s.price_from_pence !== null ? ` ${gbp(s.price_from_pence)}` : ""}”.`); continue; }
    const cur = saved.services[f[0]];
    const patch: ServicePatch = { ...(s.duration_min !== null ? { duration_min: s.duration_min } : {}), ...(s.price_from_pence !== null ? { price_from_pence: s.price_from_pence } : {}) };
    const parts = [
      ...(patch.price_from_pence !== undefined && patch.price_from_pence !== cur.price_from_pence ? [`${gbp(cur.price_from_pence)} → ${gbp(patch.price_from_pence)}`] : []),
      ...(patch.duration_min !== undefined && patch.duration_min !== cur.duration_min ? [`${cur.duration_min} → ${patch.duration_min} min`] : []),
    ];
    if (!parts.length) { asks.push(`${cur.name} is already ${cur.duration_min} min, ${gbp(cur.price_from_pence)}.`); continue; }
    changes.push({ kind: "service_update", name: cur.name, patch });
    undo.push({ kind: "service_update", name: cur.name, patch: { duration_min: cur.duration_min, price_from_pence: cur.price_from_pence } });
    done.push(`${cur.name}: ${parts.join(", ")}`);
  }
  if (!changes.length) return { topic: "services", ask: asks.join(" ") };
  return plan("services", changes, undo, done, asks);
}

/** Reads one request against what's saved. Null means it isn't a change request. */
export function interpret(text: string, saved: Saved, sector?: string | null): Interpretation {
  const t = clean(text);
  if (!t) return null;

  const pol = t.match(POLICY);
  if (pol || (/bank\s*hol/i.test(t) && /\b(closed|shut|open|off)\b/i.test(t))) {
    const line = pol ? sentence(pol[1]) : /\bopen\b/i.test(t) && !/\b(closed|shut|off)\b/i.test(t) ? sentence(t) : "We're closed on bank holidays.";
    const description = [saved.description?.trim(), line].filter(Boolean).join("\n");
    if (description.length > 4000) return { topic: "policies", ask: "Your business description is full (4,000 characters). Shorten it in Workspace first." };
    return plan("policies", [{ kind: "profile", patch: { description } }], [{ kind: "profile", patch: { description: saved.description } }], [`Added to what the receptionist tells callers: “${line}”`]);
  }
  if (RECEPTIONIST.test(t)) { const r = receptionist(t, saved); if (r) return r; }

  if (PHONE_CUE.test(t)) {
    const phone = parsePhone(t);
    if (phone) {
      if (phone.replace(/\D/g, "") === (saved.phone ?? "").replace(/\D/g, "")) return { topic: "phone", ask: `Your number is already ${saved.phone}.` };
      return plan("phone", [{ kind: "profile", patch: { phone } }], [{ kind: "profile", patch: { phone: saved.phone } }], [`Phone: ${saved.phone ?? "none"} → ${phone}`]);
    }
  }
  if (ADDRESS_CUE.test(t) && !HOURS_CUE.test(t.replace(/\b(sat|sun|mon|wed|fri)\w*\b/gi, ""))) {
    const body = t.replace(/^.*?\b(?:moved|moving|relocat\w*|address|premises|location|unit|we'?re (?:now )?(?:at|based at|located at))\b\s*(?:is\s+)?(?:now\s+)?(?:to|:|at|-)?\s*/i, "");
    const a = parseAddress(body);
    if (a.postcode || (a.address_line1 && a.city)) {
      const before = [saved.address_line1, saved.city, saved.postcode].filter(Boolean).join(", ") || "none";
      const after = [a.address_line1, a.city, a.postcode].filter(Boolean).join(", ");
      return plan("address", [{ kind: "profile", patch: a }], [{ kind: "profile", patch: { address_line1: saved.address_line1, city: saved.city, postcode: saved.postcode } }], [`Address: ${before} → ${after}`]);
    }
    if (/\b(address|moved)\b/i.test(t)) return { topic: "address", ask: "What's the new address? Street, town and postcode, e.g. “12 High Street, Bristol, BS1 4DJ”." };
  }

  const rm = calm(t).match(REMOVE);
  if (rm) {
    const what = rm[1].replace(/\b(?:from (?:the |my |our )?(?:list|menu|services))\b/i, "").trim();
    const found = targets(what, saved.services);
    if (found.hits.length) {
      const gone = found.hits.map((i) => saved.services[i]);
      const notes = [...found.ambiguous.map((a) => `${a} — which one?`), ...found.missing.map((m) => `I can't find “${m}” in your services.`)];
      return plan("services", [{ kind: "service_remove", names: gone.map((s) => s.name) }], [{ kind: "service_add", services: gone }], [`Removed ${list(gone.map((s) => s.name))}`], notes);
    }
    if (found.ambiguous.length) return { topic: "services", ask: `${found.ambiguous.join("; ")} — which one?` };
    if (!parseDays(what).length) return { topic: "services", ask: `I can't find “${what}” in your services${saved.services.length ? `. You have: ${list(saved.services.map((s) => s.name).slice(0, 12))}${saved.services.length > 12 ? "…" : ""}` : " — none are saved yet"}.` };
  }
  const add = t.match(ADD);
  if (add && (/\d|£|free/i.test(add[1]) || !HOURS_CUE.test(add[1]))) return addServices(add[1], saved, sector);

  if (BULK.test(t) && /\b(prices?|services?|everything|all)\b/i.test(t)) { const b = bulkPrices(t, saved); if (b) return b; }
  if (CAPACITY_CUE.test(t) && !/^\s*(?:rename|change)\b.*\bto\b/i.test(t)) { const c = capacity(t, saved); if (c) return c; }

  // A service by name with a new price or time wins over hours ("Saturday special £10" is rare;
  // "skin fade 45 min" is common), unless the message is about days.
  const upd = updateServices(t, saved);
  if (upd && "plan" in upd) return upd;
  if (HOURS_CUE.test(t)) { const h = hours(t, saved); if (h) return h; }
  return upd;
}

/** The same summary line, the other way round, for “undo”: "Skin fade: £24 → £25" → "Skin fade: £25 → £24". */
export function reverseLine(line: string): string {
  const added = line.match(/^Added (.+?) — /);
  if (added) return `Removed ${added[1]}`;
  const removed = line.match(/^Removed (.+)$/);
  if (removed) return `Put back ${removed[1]}`;
  if (/^Added to what the receptionist tells callers: /.test(line)) return line.replace(/^Added to/, "Taken out of");
  const prices = line.match(/^(.+ prices|All prices) (up|down) (.+?)( \(.*)?:$/);
  if (prices) return `${prices[1]} back ${prices[2] === "up" ? "down" : "up"} by ${prices[3]}:`;
  const m = line.match(/^(\s*)(.*?: |Renamed )?(.+?) → (.+)$/);
  return m ? `${m[1]}${m[2] ?? ""}${m[4]} → ${m[3]}` : line;
}

/** What the owner sees after a change: what happened, anything assumed, and how to undo it. */
export function describePlan(p: Plan): string[] {
  const body = p.done.length === 1 ? ` — ${p.done[0]}` : `:\n${p.done.map((d) => (d.startsWith("  ") ? d : `• ${d}`)).join("\n")}`;
  return [`Done${body}`, ...p.notes, "Say “undo” to put it back."];
}
