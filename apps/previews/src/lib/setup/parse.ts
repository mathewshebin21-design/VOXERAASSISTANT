// Understands everyday answers to setup questions ("Mon–Fri 9–5:30, Sat 10–2",
// "Women's cut, 60 min, £45") so the free guided assistant can fill in a workspace.
// Every parser returns what it understood AND what it couldn't, and every assumption it
// made, so nothing is guessed silently. Owners type these answers in many different ways:
// see parse.test.ts for the phrasings each parser is held to.

export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export interface Period { opens: string; closes: string } // "HH:MM"
/** index 0 = Monday … 6 = Sunday. Each day lists its opening periods in order; [] = closed. */
export type Week = Period[][];
export const closedWeek = (): Week => [[], [], [], [], [], [], []];

export interface HoursResult {
  week: Week;
  understood: boolean;
  /** Days the answer explicitly set (open or closed), so a short correction can be merged. */
  touched: number[];
  unparsed: string[];
  assumptions: string[];
}

const DAY_RE: [RegExp, number][] = [
  [/^mon(day)?s?$/, 0], [/^tue(s|sday)?s?$/, 1], [/^wed(s|nesday)?s?$/, 2], [/^thu(r|rs|rsday)?s?$/, 3],
  [/^fri(day)?s?$/, 4], [/^sat(urday)?s?$/, 5], [/^sun(day)?s?$/, 6],
];
const dayIndex = (w: string): number | null => { for (const [re, i] of DAY_RE) if (re.test(w)) return i; return null; };
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/** Days mentioned in a phrase: "mon-fri", "monday to friday", "sat & sun", "weekdays", "every day". */
export function parseDays(text: string): number[] {
  const t = text.toLowerCase();
  if (/\b(every ?day|daily|7 days|seven days|all week|mon(day)?\s*(-|–|to|through|thru)\s*sun(day)?)\b/.test(t)) return [...ALL_DAYS];
  const out = new Set<number>();
  if (/\bweek ?days\b/.test(t)) [0, 1, 2, 3, 4].forEach((d) => out.add(d));
  if (/\bweek ?ends?\b/.test(t)) [5, 6].forEach((d) => out.add(d));
  const words = t.replace(/[^a-z\s–-]/g, " ").replace(/–/g, "-").replace(/\s*-\s*/g, " - ").split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const a = dayIndex(words[i]);
    if (a === null) continue;
    const joiner = words[i + 1];
    const b = joiner && /^(-|to|through|thru|till|until)$/.test(joiner) ? dayIndex(words[i + 2] ?? "") : null;
    if (b !== null) {
      for (let d = a; ; d = (d + 1) % 7) { out.add(d); if (d === b) break; }
      i += 2;
    } else out.add(a);
  }
  return [...out].sort((x, y) => x - y);
}

const pad = (n: number) => String(n).padStart(2, "0");
const TIME = String.raw`(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?`;
const RANGE_SRC = `${TIME}\\s*(?:-|–|to|till|til|until)\\s*${TIME}`;
const RANGE = new RegExp(RANGE_SRC, "i");
const NOON = /\b(noon|midday)\b/gi;
const ALL_DAY = /\b(24\s*(?:hours?|hrs?|h)|24\s*\/\s*7|all day|round the clock)\b/i;

interface Range { opens: string; closes: string; assumed: boolean }

function rangeFrom(m: RegExpMatchArray): Range | null {
  const [, h1s, m1s, ap1raw, h2s, m2s, ap2raw] = m;
  const ap = (x?: string) => (x ? (x.toLowerCase().startsWith("p") ? "pm" : "am") : undefined);
  let h1 = Number(h1s), h2 = Number(h2s);
  const m1 = Number(m1s ?? 0), m2 = Number(m2s ?? 0);
  const a1 = ap(ap1raw), a2 = ap(ap2raw);
  let assumed = false;
  const to24 = (h: number, a?: string) => (a === "pm" && h < 12 ? h + 12 : a === "am" && h === 12 ? 0 : h);
  h1 = to24(h1, a1);
  h2 = to24(h2, a2);
  if (!a1 && !a2 && h1 >= 1 && h1 <= 5 && h2 > h1 && h2 <= 8) { h1 += 12; h2 += 12; assumed = true; } // "1-5": afternoon
  if (!a2 && h2 <= 12 && h2 * 60 + m2 <= h1 * 60 + m1) { h2 += 12; assumed = !a1; } // "9-5" → 5pm
  if (!a1 && h1 < 7 && h1 + 12 < h2) h1 += 12;                                      // "1-5pm": nobody opens at 1am
  if (h1 > 23 || h2 > 24 || m1 > 59 || m2 > 59) return null;
  if (h2 === 24) { h2 = 23; if (m2 === 0) return finish(h1, m1, 23, 59, assumed); }
  return finish(h1, m1, h2, m2, assumed);
}
function finish(h1: number, m1: number, h2: number, m2: number, assumed: boolean): Range | null {
  if (h1 * 60 + m1 >= h2 * 60 + m2) return null;
  return { opens: `${pad(h1)}:${pad(m1)}`, closes: `${pad(h2)}:${pad(m2)}`, assumed };
}

/** "9-5" → 09:00–17:00, "9am-5:30pm", "10 till 2", "8-8" → 08:00–20:00. Returns null if no range. */
export function parseRange(text: string): Range | null {
  const m = text.replace(NOON, "12pm").match(RANGE);
  return m ? rangeFrom(m) : null;
}

/** Every time range in a phrase: "9-12 and 1-5" → two periods. */
export function parseRanges(text: string): Range[] {
  const t = text.replace(NOON, "12pm");
  if (ALL_DAY.test(t)) return [{ opens: "00:00", closes: "23:59", assumed: false }];
  return [...t.matchAll(new RegExp(RANGE_SRC, "gi"))].map(rangeFrom).filter((r): r is Range => r !== null);
}

/** Sorted, with overlapping or touching periods joined. */
function tidy(periods: Period[]): Period[] {
  const xs = [...periods].sort((a, b) => a.opens.localeCompare(b.opens));
  const out: Period[] = [];
  for (const p of xs) {
    const last = out[out.length - 1];
    if (last && p.opens <= last.closes) last.closes = p.closes > last.closes ? p.closes : last.closes;
    else out.push({ opens: p.opens, closes: p.closes });
  }
  return out;
}

/** Takes a break ("closed 1-2 for lunch") out of a day's periods. */
function withBreak(periods: Period[], br: Period): Period[] {
  return periods.flatMap((p) => {
    if (br.closes <= p.opens || br.opens >= p.closes) return [p];
    return [{ opens: p.opens, closes: br.opens }, { opens: br.closes, closes: p.closes }].filter((x) => x.opens < x.closes);
  });
}

const EXCEPT = /\b(?:except(?:\s+for)?|apart from|but not|not on|excluding|other than)\b/i;
const CLOSED = /\b(closed|shut|off)\b/i;
const EDGE = /(?:late|till|until|to)\s+(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/i;

/**
 * Phrases split on commas, and on "and" when the part before it is already complete:
 * "Thursday till 9 and Sunday closed" → two phrases, but "Sun and Mon closed" stays one.
 */
function phrases(text: string): string[] {
  const complete = (s: string) => RANGE.test(s) || CLOSED.test(s) || EDGE.test(s) || ALL_DAY.test(s);
  return text.split(/[;,\n]+|\.\s+/).map((s) => s.trim()).filter(Boolean).flatMap((seg) => {
    const out: string[] = [];
    for (const piece of seg.split(/\s+(?:and|&)\s+(?=(?:on\s+)?(?:mon|tue|wed|thu|fri|sat|sun|week|every|daily))/i)) {
      if (out.length && !complete(out[out.length - 1])) out[out.length - 1] += ` and ${piece}`;
      else out.push(piece);
    }
    return out;
  });
}

/**
 * "Mon–Fri 9–5:30, Thu late till 8pm, Sat 10–2, Sun closed". Later phrases override earlier ones.
 * `base` is a week already shown to the owner: corrections such as "Thursday till 9" move that
 * day's closing time instead of needing the whole day again.
 */
export function parseHours(text: string, base?: Week): HoursResult {
  const week = base ? base.map((d) => d.map((p) => ({ ...p }))) : closedWeek();
  const touched = new Set<number>();
  const unparsed: string[] = [];
  const assumptions: string[] = [];
  let understood = false;
  // A days-only phrase waiting for its times ("Monday to Friday, 9-5"), or the other way round.
  let carryDays: { days: number[]; seg: string } | null = null;
  let carryRanges: { ranges: Range[]; seg: string } | null = null;
  const set = (days: number[], periods: Period[]) => { days.forEach((d) => { week[d] = tidy(periods); touched.add(d); }); understood = true; };

  for (const seg of phrases(text)) {
    const ex = seg.match(EXCEPT);
    const head = ex ? seg.slice(0, ex.index) : seg;
    const excluded = ex ? parseDays(seg.slice((ex.index ?? 0) + ex[0].length)) : [];
    let days = parseDays(head);
    if (ex && !days.length) days = [...ALL_DAYS]; // "open 9-6 except Sundays"
    days = days.filter((d) => !excluded.includes(d));
    if (!days.length && ALL_DAY.test(seg) && !CLOSED.test(seg)) days = [...ALL_DAYS]; // "24/7"
    const ranges = parseRanges(seg);
    if (/bank\s*hol/i.test(seg)) assumptions.push("bank holidays aren't part of the weekly hours: add a line about them to your business description in Workspace so the receptionist can tell callers");

    if (CLOSED.test(seg) && !ex) {
      // "Mon-Fri 9-5 closed 1-2 for lunch": times before "closed" are opening hours, after it a break.
      const at = seg.search(CLOSED);
      const open = parseRanges(seg.slice(0, at)), breaks = parseRanges(seg.slice(at));
      if (open.length && days.length) set(days, open);
      if (breaks.length) {
        const on = days.length ? days : ALL_DAYS.filter((d) => week[d].length);
        if (!on.length) { unparsed.push(seg); continue; }
        on.forEach((d) => { week[d] = breaks.reduce((ps, r) => withBreak(ps, r), week[d]); touched.add(d); });
        understood = true;
      } else if (days.length && !open.length) set(days, []);
      else if (!days.length && !/bank\s*hol/i.test(seg)) unparsed.push(seg);
      continue;
    }
    if (excluded.length) { excluded.forEach((d) => { week[d] = []; touched.add(d); }); understood = true; }

    if (!days.length && ranges.length && carryDays) { days = carryDays.days; carryDays = null; }
    let rs = ranges;
    if (days.length && !rs.length && carryRanges && !EDGE.test(seg)) { rs = carryRanges.ranges; carryRanges = null; }

    const edge = seg.match(EDGE);
    if (rs.length && days.length) {
      set(days, rs);
      rs.filter((r) => r.assumed).forEach((r) => assumptions.push(`"${seg}": read the times as ${r.opens}–${r.closes}`));
    } else if (!rs.length && edge && days.length && days.every((d) => week[d].length)) {
      // "Thu late till 8pm": keep the opening time, move the close.
      const close = parseRange(`00:00-${edge[1]}${edge[2] ? ":" + edge[2] : ""}${edge[3] ?? (Number(edge[1]) < 12 ? "pm" : "")}`);
      if (close) { days.forEach((d) => { const ps = week[d]; ps[ps.length - 1] = { ...ps[ps.length - 1], closes: close.closes }; touched.add(d); }); understood = true; }
      else unparsed.push(seg);
    } else if (days.length && !rs.length) {
      if (carryDays) unparsed.push(carryDays.seg);
      carryDays = { days, seg };
    } else if (rs.length && !days.length) {
      if (carryRanges) unparsed.push(carryRanges.seg);
      carryRanges = { ranges: rs, seg };
    } else if (!excluded.length) unparsed.push(seg);
  }
  if (carryDays) unparsed.push(carryDays.seg);
  if (carryRanges) unparsed.push(carryRanges.seg);
  return { week, understood, touched: [...touched].sort(), unparsed, assumptions };
}

export const describeDay = (ps: Period[]) => (ps.length ? ps.map((p) => `${p.opens}–${p.closes}`).join(" and ") : "closed");
export const describeWeek = (w: Week) => w.map((d, i) => `${DAY_NAMES[i]}: ${describeDay(d)}`);

export interface ParsedService {
  name: string;
  duration_min: number | null;
  price_from_pence: number | null;
  requires_patch_test: boolean;
  /** From a heading line such as "Haircuts:" above the service. */
  category: string | null;
  /** What was assumed while reading the line, to show the owner before saving. */
  notes: string[];
  raw: string;
}

const MONEY = String.raw`(\d+(?:[.,]\d{1,2})?)`;
const PRICE_RANGE = new RegExp(String.raw`£\s*${MONEY}\s*(?:-|–|to)\s*£?\s*${MONEY}|${MONEY}\s*(?:-|–|to)\s*${MONEY}\s*(?:pounds|gbp|quid)\b`, "i");
const PRICE = new RegExp(String.raw`£\s*${MONEY}|${MONEY}\s*(?:pounds|gbp|quid)\b`, "i");
const FREE = /\b(free|no charge|complimentary)\b/i;
const POA = /\b(p\.?o\.?a\.?|price on (?:application|request)|prices? vary|varies)\b/i;
const HM = /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)(?![a-z])\.?\s*(?:and\s*)?(?:(\d{1,2})(?:\s*(?:m|min|mins|minutes)(?![a-z]))?)?/i;
const MINS = /(\d{1,3})\s*(m|min|mins|minutes)\b/i;
const WORD_DURATIONS: [RegExp, number][] = [
  [/\b(an? |one )?hour and a half\b/i, 90], [/\bhalf an hour\b/i, 30], [/\b(a |one )?quarter of an hour\b/i, 15], [/\b(an|one) hour\b/i, 60],
];
const UNITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const WORD_PRICE = new RegExp(`\\b(?:(${TENS.filter(Boolean).join("|")})(?:[\\s-]+(${UNITS.slice(1, 10).join("|")}))?|(${UNITS.slice(1).join("|")})|(a hundred|one hundred))\\s+(?:pounds|quid)\\b`, "i");
const wordPrice = (m: RegExpMatchArray) =>
  m[4] ? 100 : m[3] ? UNITS.indexOf(m[3].toLowerCase()) : TENS.indexOf(m[1].toLowerCase()) * 10 + (m[2] ? UNITS.indexOf(m[2].toLowerCase()) : 0);
const pounds = (s: string) => Math.round(Number(s.replace(",", ".")) * 100);
const gbp = (p: number) => `£${(p / 100).toFixed(p % 100 ? 2 : 0)}`;

function hasAttr(text: string): boolean {
  return PRICE.test(text) || WORD_PRICE.test(text) || HM.test(text) || MINS.test(text) || FREE.test(text) || WORD_DURATIONS.some(([re]) => re.test(text));
}
const isAttrOnly = (piece: string) =>
  !piece.replace(PRICE_RANGE, " ").replace(PRICE, " ").replace(WORD_PRICE, " ").replace(HM, " ").replace(MINS, " ").replace(FREE, " ").replace(POA, " ")
    .replace(/\b(from|starting at|about|approx\.?|each|per person|pp|needs?|requires?|with|a|patch[- ]?test)\b/gi, " ").replace(/[^\p{L}]/gu, "").trim();

function parseOne(raw: string, category: string | null): ParsedService | null {
  let rest = raw;
  const notes: string[] = [];
  let duration: number | null = null;
  const hm = rest.match(HM);
  const mins = rest.match(MINS);
  const word = WORD_DURATIONS.find(([re]) => re.test(rest));
  if (hm) { duration = Math.round(Number(hm[1]) * 60 + Number(hm[2] ?? 0)); rest = rest.replace(hm[0], " "); }
  else if (mins) { duration = Number(mins[1]); rest = rest.replace(mins[0], " "); }
  else if (word) { duration = word[1]; rest = rest.replace(word[0], " "); }

  let price: number | null = null;
  const range = rest.match(PRICE_RANGE);
  if (range) {
    const lo = pounds(range[1] ?? range[3]), hi = pounds(range[2] ?? range[4]);
    price = Math.min(lo, hi);
    notes.push(`price range ${gbp(Math.min(lo, hi))}–${gbp(Math.max(lo, hi))}: saved ${gbp(price)} as the starting price`);
    rest = rest.replace(range[0], " ");
  } else {
    const pm = rest.match(PRICE);
    if (pm) { price = pounds(pm[1] ?? pm[2]); rest = rest.replace(pm[0], " "); }
  }
  const wp = price === null ? rest.match(WORD_PRICE) : null;
  if (wp) { price = wordPrice(wp) * 100; rest = rest.replace(wp[0], " "); }
  if (price === null && FREE.test(rest)) { price = 0; rest = rest.replace(FREE, " "); }
  if (POA.test(rest)) { notes.push("no fixed price: callers will be told the price is confirmed on the day"); rest = rest.replace(POA, " "); }

  // A bare number left over: "Mens cut 30 mins 20" → £20, "Skin fade 45 £24" → 45 minutes.
  const bare = rest.match(/\s(\d{1,4}(?:\.\d{2})?)\s*$/);
  if (bare) {
    const n = Number(bare[1]);
    if (price === null && duration !== null) { price = Math.round(n * 100); notes.push(`read "${bare[1]}" as ${gbp(price)}`); rest = rest.replace(bare[0], " "); }
    else if (duration === null && price !== null && Number.isInteger(n) && n >= 5 && n <= 240) { duration = n; notes.push(`read "${bare[1]}" as ${n} minutes`); rest = rest.replace(bare[0], " "); }
  }

  const patch = /\bpatch[- ]?test\b/i.test(rest);
  const name = rest
    .replace(/\(?\b(needs?|requires?|with)\s+(a\s+)?patch[- ]?test\b\)?/i, " ")
    .replace(/\b(from|starting at|starts at|about|approx\.?|each|per person|pp)\b/gi, " ")
    .replace(/\(\s*\)|\[\s*\]/g, " ")
    .replace(/[–—:|•*=]+|\s-+\s|^\s*-+|-+\s*$/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,]+|[\s,]+$/g, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/^(add|plus)\s+/i, "")
    .replace(/(\s+(is|are|costs?|at|for|to|should be|takes|now|please))+$/i, "")
    .trim();
  if (!name || !/\p{L}/u.test(name) || name.length > 120 || (duration === null && price === null && name.split(" ").length > 8)) return null;
  if (duration !== null && (duration < 5 || duration > 600)) return null;
  return { name: name[0].toUpperCase() + name.slice(1), duration_min: duration, price_from_pence: price, requires_patch_test: patch, category, notes, raw };
}

/**
 * One service per line (or ";"), or several on a line separated by commas:
 * "Women's cut - 60 min - £45", "Balayage, 3 hours, from £120", "PT 1 hr £40, Group class 45 min £10".
 * A line such as "Haircuts:" sets the category for the lines below it. Pasted price lists
 * ("Skin fade ........ £24") work too.
 */
export function parseServices(text: string): { services: ParsedService[]; unparsed: string[] } {
  const services: ParsedService[] = [];
  const unparsed: string[] = [];
  let category: string | null = null;
  for (let line of text.split(/\n|;|\s\|\s/).map((s) => s.replace(/\t+/g, " ").replace(/\.{2,}|…+/g, " ").trim()).filter(Boolean)) {
    const heading = line.match(/^[-•*\s]*([\p{L}&'’ /]{2,40}?)\s*:\s*(.*)$/u);
    if (heading && !/\d/.test(heading[1])) {
      category = heading[1].trim();
      line = heading[2].trim();
      if (!line) continue;
    }
    // Group comma pieces into services: a piece that is only a time or price belongs to the
    // service before it; a piece with its own name after a complete service starts a new one.
    const groups: string[][] = [];
    for (const piece of line.split(/\s*,\s*/).filter(Boolean)) {
      const cur = groups[groups.length - 1];
      if (!cur || (!isAttrOnly(piece) && hasAttr(cur.join(" ")))) groups.push([piece]);
      else cur.push(piece);
    }
    for (const g of groups) {
      const raw = g.join(", ");
      const s = parseOne(raw, category);
      if (s) services.push(s); else unparsed.push(raw);
    }
  }
  return { services, unparsed };
}

/** UK numbers in the ways people write them: 0117 496 0123, (0117) 496 0123, +44 (0)117…, 0044 117…, 07700900123. */
export function parsePhone(text: string): string | null {
  const t = text.replace(/\(0\)/g, " ").replace(/[()]/g, " ").replace(/\b0044\s?/g, "+44 ").replace(/[ \t]+/g, " ");
  const m = t.match(/(\+44\s?\d(?:[\s.-]?\d){8,10}|\b0\d(?:[\s.-]?\d){8,10})(?!\d)/);
  return m ? m[1].replace(/[.]/g, " ").replace(/\s+/g, " ").trim() : null;
}

const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
const STREET = /\b(street|st|road|rd|lane|ln|avenue|ave|way|place|pl|square|sq|parade|close|drive|dr|crescent|terrace|row|hill|walk|green|gardens|court|broadway|parkway|precinct|arcade|centre|center)\b\.?/gi;

/** "12 High Street, Bristol, BS1 4DJ" → line1, city, postcode. Also "45 Market St Manchester M1 1AA". */
export function parseAddress(text: string): { address_line1: string | null; city: string | null; postcode: string | null } {
  const a = splitAddress(text);
  // "glasgow" → "Glasgow"; anything the owner capitalised themselves is kept as typed.
  const title = (s: string | null) => (s && s === s.toLowerCase() ? s.replace(/(^|[\s-])(\p{L})/gu, (_, b, c) => b + c.toUpperCase()) : s);
  return { address_line1: title(a.address_line1), city: title(a.city), postcode: a.postcode };
}

function splitAddress(text: string): { address_line1: string | null; city: string | null; postcode: string | null } {
  const pc = text.match(POSTCODE);
  const postcode = pc ? `${pc[1]} ${pc[2]}`.toUpperCase() : null;
  const parts = text.replace(pc?.[0] ?? "", "").split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return { address_line1: null, city: null, postcode };
  if (parts.length === 1) {
    if (!/\d/.test(parts[0])) return { address_line1: null, city: parts[0], postcode };
    // No commas: the words after the last street word are the town.
    const ends = [...parts[0].matchAll(STREET)];
    const last = ends[ends.length - 1];
    if (last) {
      const at = (last.index ?? 0) + last[0].length;
      const town = parts[0].slice(at).trim();
      if (town && /^\p{L}/u.test(town)) return { address_line1: parts[0].slice(0, at).trim(), city: town, postcode };
    }
    return { address_line1: parts[0], city: null, postcode };
  }
  return { address_line1: parts.slice(0, -1).join(", "), city: parts[parts.length - 1], postcode };
}

/** Business type from a description: "we're a barbers", "physio clinic", "plumbing". */
export function parseSector(text: string): string | null {
  const t = text.toLowerCase();
  const rules: [RegExp, string][] = [
    [/barber|gents'? (hair|groom)|men'?s (hair|groom)|male groom/, "barbershop"],
    [/spa\b|massage|wellness|reflexolog|reiki/, "wellness"],
    [/physio|dental|dentist|clinic|osteo|chiro|therap|vet\b|veterinar|podiat|optician|counsell|gp\b|doctor|surgery|chiropod/, "clinic"],
    [/aesthetic|botox|filler|lash|brow|tanning|tan\b/, "aesthetics"],
    [/salon|saloon|hair|nail|beauty|stylist|make-?up|wax/, "hair_beauty"],
    [/plumb|electric|builder|trade|clean|locksmith|garage|mechanic|\bmot\b|roof|joiner|carpent|decorat|landscap|gardener|handyman|heating|boiler|glaz|window|pest|removal/, "trades"],
    [/restaurant|caf[eé]|coffee|bakery|pub\b|\bbar\b|hotel|b&b|bistro|takeaway|venue|catering|deli\b/, "hospitality"],
    [/solicitor|law|legal|accountant|accounting|bookkeep|estate agent|letting|consult|architect|financial adviser|mortgage|insurance broker/, "professional"],
    [/agency|marketing|design studio/, "agency"],
    [/gym|fitness|yoga|pilates|personal trainer|\bpt\b|crossfit|martial|boxing|dance|swim/, "fitness"],
    [/tattoo|piercing|pet|dog|cat\b|groom|driving|car wash|valet|tutor|lesson|photograph|florist|print|repair|other/, "other"],
  ];
  for (const [re, s] of rules) if (re.test(t)) return s;
  return null;
}

export const isYes = (t: string) =>
  /^\s*(y|yes|yeah|yea|yep|yup|aye|correct|right|that'?s (right|correct|fine|good|great|it)|looks (good|right|great|fine)|all good|perfect|great|lovely|brilliant|spot on|fine|ok(ay)?|sure|save( it| them| that)?|confirm(ed)?|go ahead|go for it|do it|sounds (good|great|right)|that works|👍|✅|✔️?)(?=$|[\s,.!:;)]|\p{Extended_Pictographic})/iu.test(t) &&
  !/\b(no|not|wrong|change|but|except|instead|apart|remove|add)\b/i.test(t);
export const isSkip = (t: string) => /^\s*(skip|later|not now|pass|n\/?a|none|do (it|this) later)\b/i.test(t);
/** "yes but change Saturday to 9-5" → "change Saturday to 9-5"; null when there's no "but". */
export const yesBut = (t: string): string | null => t.match(/^\s*(?:y|yes|yeah|yep|ok(?:ay)?|mostly|almost|nearly|looks good)\b[\s,.!-]*(?:but|except|apart from that|only)\s+(.+)$/is)?.[1] ?? null;

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20 };
/**
 * "3", "three chairs", "just me", "me and 2 others" → 3. With several numbers ("4 chairs but
 * 2 barbers") the smallest wins: you can't see more people at once than you have chairs or staff.
 */
export function parseCount(text: string): number | null {
  const t = text.toLowerCase();
  const word = (w: string) => (/^\d+$/.test(w) ? Number(w) : NUMBER_WORDS[w]);
  const others = t.match(/\b(?:me|myself|i)\s+(?:and|plus|\+)\s+(\d+|[a-z]+)\b/);
  if (others && word(others[1]) !== undefined) return word(others[1]) + 1;
  const ns = [...t.matchAll(new RegExp(`\\b(\\d+|${Object.keys(NUMBER_WORDS).join("|")})\\b`, "g"))].map((m) => word(m[1]));
  if (ns.length) return Math.min(...ns);
  if (/\b(just me|only me|myself|me alone|single|solo|one at a time|just one)\b/.test(t)) return 1;
  return null;
}
