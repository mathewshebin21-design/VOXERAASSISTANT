// Wall-clock helpers for the preview. All demo times are naive local times
// (Europe/London wall clock) stored as a date key + minutes from midnight so the
// server and browser render identical output. The production scheduling engine
// (Phase 7) will be fully time-zone aware; this is deliberately simpler.

export const DEMO_TODAY = "2026-10-23"; // Friday
export const DEMO_NOW_MIN = 16 * 60 + 20; // 16:20

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

function parts(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return { y, m, d };
}

/** Day of week, 0 = Sunday. Computed in UTC so it is environment independent. */
export function dow(key: string): number {
  const { y, m, d } = parts(key);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(key: string, n: number): string {
  const { y, m, d } = parts(key);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string): number {
  const pa = parts(a), pb = parts(b);
  return Math.round((Date.UTC(pa.y, pa.m - 1, pa.d) - Date.UTC(pb.y, pb.m - 1, pb.d)) / 86_400_000);
}

export function startOfWeek(key: string): string {
  // Monday-based weeks (UK convention).
  const wd = dow(key);
  return addDays(key, wd === 0 ? -6 : 1 - wd);
}

export function weekDays(key: string): string[] {
  const s = startOfWeek(key);
  return Array.from({ length: 7 }, (_, i) => addDays(s, i));
}

export function monthGrid(key: string): string[] {
  const { y, m } = parts(key);
  const first = `${y}-${String(m).padStart(2, "0")}-01`;
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function sameMonth(a: string, b: string) {
  return a.slice(0, 7) === b.slice(0, 7);
}

export const fmtTime = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export const fmtDuration = (sec: number) => {
  const m = Math.floor(sec / 60), s = sec % 60;
  return m ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
};

export const dayShort = (key: string) => DAY_NAMES[dow(key)];
export const dayLong = (key: string) => DAY_LONG[dow(key)];
export const dayNum = (key: string) => parts(key).d;
export const monthShort = (key: string) => MONTHS[parts(key).m - 1];
export const monthLong = (key: string) => MONTHS_LONG[parts(key).m - 1];

export const fmtDate = (key: string) => `${dayShort(key)} ${dayNum(key)} ${monthShort(key)}`;
export const fmtDateLong = (key: string) => `${dayLong(key)} ${dayNum(key)} ${monthLong(key)} ${parts(key).y}`;

export function relativeDay(key: string, today = DEMO_TODAY) {
  const d = diffDays(key, today);
  if (d === 0) return "Today";
  if (d === -1) return "Yesterday";
  if (d === 1) return "Tomorrow";
  return fmtDate(key);
}

export const gbp = (n: number, dp = 2) =>
  `£${n.toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
