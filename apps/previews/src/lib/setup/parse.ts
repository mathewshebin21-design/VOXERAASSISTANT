// Understands everyday answers to setup questions ("Mon–Fri 9–5:30, Sat 10–2",
// "Women's cut, 60 min, £45") so the free guided assistant can fill in a workspace.
// Every parser returns what it understood AND what it couldn't, so nothing is guessed silently.

export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export interface DayHours { opens: string; closes: string } // "HH:MM"
export type Week = (DayHours | null)[]; // index 0 = Monday … 6 = Sunday; null = closed

export interface HoursResult { week: Week; understood: boolean; unparsed: string[]; assumptions: string[] }

const DAY_RE: [RegExp, number][] = [
  [/^mon(day)?s?$/, 0], [/^tue(s|sday)?s?$/, 1], [/^wed(s|nesday)?s?$/, 2], [/^thu(r|rs|rsday)?s?$/, 3],
  [/^fri(day)?s?$/, 4], [/^sat(urday)?s?$/, 5], [/^sun(day)?s?$/, 6],
];
const dayIndex = (w: string): number | null => { for (const [re, i] of DAY_RE) if (re.test(w)) return i; return null; };

/** Days mentioned in a phrase: "mon-fri", "monday to friday", "sat & sun", "weekdays", "every day". */
export function parseDays(text: string): number[] {
  const t = text.toLowerCase();
  if (/\b(every ?day|daily|7 days|seven days|all week|mon(day)?\s*(-|–|to|through|thru)\s*sun(day)?)\b/.test(t)) return [0, 1, 2, 3, 4, 5, 6];
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
const RANGE = new RegExp(`${TIME}\\s*(?:-|–|to|till|til|until)\\s*${TIME}`, "i");
const NOON = /\b(noon|midday)\b/gi;

/** "9-5" → 09:00–17:00, "9am-5:30pm", "10 till 2", "8-8" → 08:00–20:00. Returns null if no range. */
export function parseRange(text: string): { opens: string; closes: string; assumed: boolean } | null {
  const m = text.replace(NOON, "12pm").match(RANGE);
  if (!m) return null;
  const [, h1s, m1s, ap1raw, h2s, m2s, ap2raw] = m;
  const ap = (x?: string) => (x ? (x.toLowerCase().startsWith("p") ? "pm" : "am") : undefined);
  let h1 = Number(h1s), h2 = Number(h2s);
  const m1 = Number(m1s ?? 0), m2 = Number(m2s ?? 0);
  const a1 = ap(ap1raw), a2 = ap(ap2raw);
  let assumed = false;
  const to24 = (h: number, a?: string) => (a === "pm" && h < 12 ? h + 12 : a === "am" && h === 12 ? 0 : h);
  h1 = to24(h1, a1);
  h2 = to24(h2, a2);
  if (!a2 && h2 <= 12 && h2 * 60 + m2 <= h1 * 60 + m1) { h2 += 12; assumed = !a1; } // "9-5" → 5pm
  if (!a1 && h1 < 7 && h1 + 12 < h2) h1 += 12;                                      // "1-5pm": nobody opens at 1am
  if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return null;
  if (h1 * 60 + m1 >= h2 * 60 + m2) return null;
  return { opens: `${pad(h1)}:${pad(m1)}`, closes: `${pad(h2)}:${pad(m2)}`, assumed };
}

/** "Mon–Fri 9–5:30, Thu late till 8pm, Sat 10–2, Sun closed". Later phrases override earlier ones. */
export function parseHours(text: string): HoursResult {
  const week: Week = [null, null, null, null, null, null, null];
  const unparsed: string[] = [];
  const assumptions: string[] = [];
  let understood = false;
  for (const seg of text.split(/[;,\n]+|\.\s+/).map((s) => s.trim()).filter(Boolean)) {
    const days = parseDays(seg);
    if (/\bclosed\b/i.test(seg)) {
      if (!days.length) { unparsed.push(seg); continue; }
      days.forEach((d) => (week[d] = null));
      understood = true;
      continue;
    }
    const late = seg.match(new RegExp(`(?:late|till|until|to)\\s+${TIME}`, "i"));
    const r = parseRange(seg);
    if (r && days.length) {
      days.forEach((d) => (week[d] = { opens: r.opens, closes: r.closes }));
      if (r.assumed) assumptions.push(`"${seg}": read the closing time as ${r.closes}`);
      understood = true;
    } else if (!r && late && days.length && days.every((d) => week[d])) {
      // "Thu late till 8pm": keep the opening time, extend the close.
      const close = parseRange(`00:00-${late[1]}${late[2] ? ":" + late[2] : ""}${late[3] ?? (Number(late[1]) < 12 ? "pm" : "")}`);
      if (close) { days.forEach((d) => (week[d] = { opens: week[d]!.opens, closes: close.closes })); understood = true; } else unparsed.push(seg);
    } else unparsed.push(seg);
  }
  return { week, understood, unparsed, assumptions };
}

export const describeWeek = (w: Week) => w.map((d, i) => `${DAY_NAMES[i]}: ${d ? `${d.opens}–${d.closes}` : "closed"}`);

export interface ParsedService { name: string; duration_min: number | null; price_from_pence: number | null; requires_patch_test: boolean; raw: string }

/** One service per line (or ";"): "Women's cut - 60 min - £45", "Balayage, 3 hours, from £120", "Gents cut 30mins £20". */
export function parseServices(text: string): { services: ParsedService[]; unparsed: string[] } {
  const services: ParsedService[] = [];
  const unparsed: string[] = [];
  for (const raw of text.split(/\n|;|\s\|\s/).map((s) => s.trim()).filter(Boolean)) {
    let rest = raw;
    let duration: number | null = null;
    const hm = rest.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)(?![a-z])\.?\s*(?:and\s*)?(?:(\d{1,2})(?:\s*(?:m|min|mins|minutes)(?![a-z]))?)?/i);
    const mins = rest.match(/(\d{1,3})\s*(m|min|mins|minutes)\b/i);
    if (hm) { duration = Math.round(Number(hm[1]) * 60 + Number(hm[2] ?? 0)); rest = rest.replace(hm[0], " "); }
    else if (mins) { duration = Number(mins[1]); rest = rest.replace(mins[0], " "); }
    let price: number | null = null;
    const pm = rest.match(/£\s*(\d+(?:[.,]\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:pounds|gbp|quid)\b/i);
    if (pm) { price = Math.round(Number((pm[1] ?? pm[2]).replace(",", ".")) * 100); rest = rest.replace(pm[0], " "); }
    const patch = /\bpatch[- ]?test\b/i.test(rest);
    const name = rest
      .replace(/\(?\b(needs?|requires?|with)\s+(a\s+)?patch[- ]?test\b\)?/i, " ")
      .replace(/\b(from|starting at|about|approx\.?)\b/gi, " ")
      .replace(/[-–—:,|•*]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^\d+[.)]\s*/, "");
    if (!name || name.length > 120 || (duration === null && price === null && name.split(" ").length > 8)) { unparsed.push(raw); continue; }
    if (duration !== null && (duration < 5 || duration > 600)) { unparsed.push(raw); continue; }
    services.push({ name: name[0].toUpperCase() + name.slice(1), duration_min: duration, price_from_pence: price, requires_patch_test: patch, raw });
  }
  return { services, unparsed };
}

const PHONE = /(\+44\s?\(?0?\)?\s?\d(?:[\s-]?\d){8,10}|\b0\d(?:[\s-]?\d){8,10})\b/;
export function parsePhone(text: string): string | null {
  const m = text.match(PHONE);
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
/** "12 High Street, Bristol, BS1 4DJ" → line1, city, postcode. */
export function parseAddress(text: string): { address_line1: string | null; city: string | null; postcode: string | null } {
  const pc = text.match(POSTCODE);
  const postcode = pc ? `${pc[1]} ${pc[2]}`.toUpperCase() : null;
  const parts = text.replace(pc?.[0] ?? "", "").split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return { address_line1: null, city: null, postcode };
  if (parts.length === 1) return /\d/.test(parts[0]) ? { address_line1: parts[0], city: null, postcode } : { address_line1: null, city: parts[0], postcode };
  return { address_line1: parts.slice(0, -1).join(", "), city: parts[parts.length - 1], postcode };
}

/** Business type from a description: "we're a barbers", "physio clinic", "plumbing". */
export function parseSector(text: string): string | null {
  const t = text.toLowerCase();
  const rules: [RegExp, string][] = [
    [/physio|dental|dentist|clinic|osteo|chiro|therap|vet\b|veterinar|podiat|optician|counsell/, "clinic"],
    [/spa\b|massage|wellness/, "wellness"],
    [/aesthetic|botox|filler|lash|brow/, "aesthetics"],
    [/barber/, "barbershop"],
    [/salon|saloon|hair|nail|beauty|stylist/, "hair_beauty"],
    [/plumb|electric|builder|trade|clean|locksmith|garage|mechanic|roof|joiner|carpent|decorat|landscap|gardener|handyman/, "trades"],
    [/restaurant|caf[eé]|pub\b|bar\b|hotel|b&b|bistro|takeaway|venue|catering/, "hospitality"],
    [/solicitor|law|legal|accountant|accounting|bookkeep|estate agent|letting|consult|architect|financial adviser/, "professional"],
    [/agency|marketing|design studio/, "agency"],
    [/gym|fitness|yoga|pilates|personal trainer|crossfit|martial|dance/, "fitness"],
  ];
  for (const [re, s] of rules) if (re.test(t)) return s;
  return null;
}

export const isYes = (t: string) => /^\s*(y|yes|yeah|yep|yup|correct|right|that'?s (right|correct|fine)|looks (good|right)|perfect|ok(ay)?|sure|save( it)?|confirm)\b/i.test(t) && !/\b(no|not|wrong|change)\b/i.test(t);
export const isSkip = (t: string) => /^\s*(skip|later|not now|pass|n\/?a|none)\b/i.test(t);
