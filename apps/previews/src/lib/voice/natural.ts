// Making the free browser voice sound less robotic.
//
// Browsers ship many voices and the default is often the flattest one. We score the
// installed voices and pick the most natural sounding (neural / enhanced / premium
// voices first, novelty and "compact" voices never), and we rewrite text so it is read
// the way a person would say it ("half past two", not "fourteen thirty").

const GOOD = [
  /natural/i, /neural/i, /premium/i, /enhanced/i, /online/i, // Edge "Online (Natural)", Apple "Enhanced/Premium"
  /google uk english/i, /google us english/i,
  /\b(sonia|libby|maisie|ryan|thomas|abbi|bella|hollie|olivia|alfie|elliot)\b/i, // Microsoft UK neural voices
  /\b(serena|kate|daniel|arthur|martha|stephanie|jamie|oliver|moira|karen|ava|samantha|evan|zoe|allison|nathan|tom)\b/i, // Apple voices
  /siri/i,
];
const BAD = [
  /compact/i, /espeak/i, /\bmbrola\b/i,
  /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|ralph|kathy|grandma|grandpa|rocko|shelley|flo|eddy|reed|sandy)\b/i,
];

export function scoreVoice(v: Pick<SpeechSynthesisVoice, "name" | "lang" | "localService">, lang = "en-GB"): number {
  if (!v.lang?.toLowerCase().startsWith("en")) return -100;
  if (BAD.some((r) => r.test(v.name))) return -50;
  let s = 0;
  if (v.lang.replace("_", "-").toLowerCase() === lang.toLowerCase()) s += 20;
  GOOD.forEach((r, i) => { if (r.test(v.name)) s += i < 5 ? 30 : 15; });
  if (/female|woman/i.test(v.name)) s += 1;
  return s;
}

/** The most natural voice installed for `lang`, or undefined to let the browser choose. */
export function pickVoice(voices: SpeechSynthesisVoice[], lang = "en-GB"): SpeechSynthesisVoice | undefined {
  const ranked = voices.map((v) => ({ v, s: scoreVoice(v, lang) })).filter((x) => x.s > -50).sort((a, b) => b.s - a.s);
  return ranked[0]?.v;
}

const NUM = ["twelve", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven"];

/** "14:30" → "half past two"; "09:00" → "nine o'clock"; "16:45" → "quarter to five". */
export function spokenClock(h: number, m: number): string {
  const day = h < 12 ? " in the morning" : h < 17 ? " in the afternoon" : " in the evening";
  if (m === 0) return h === 12 ? "midday" : `${NUM[h % 12]} o'clock${day}`;
  if (m === 30) return `half past ${NUM[h % 12]}`;
  if (m === 15) return `quarter past ${NUM[h % 12]}`;
  if (m === 45) return `quarter to ${NUM[(h + 1) % 12]}`;
  return `${NUM[h % 12]} ${m < 10 ? `oh ${m}` : m}`;
}

/** Rewrites a reply so a speech engine reads it like a person would say it. */
export function speakable(text: string): string {
  return text
    .replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g, (_, h, m) => spokenClock(Number(h), Number(m)))
    .replace(/£(\d+)\.00\b/g, "£$1")
    .replace(/\s+[—–]\s+/g, ", ")
    .replace(/\s*·\s*/g, ", ")
    .replace(/\be\.g\./gi, "for example")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Speak through the browser with the best voice and natural phrasing. Resolves when done. */
export function speakNaturally(text: string, o: { rate?: number; lang?: string } = {}): SpeechSynthesisUtterance | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const synth = window.speechSynthesis;
  const lang = o.lang ?? "en-GB";
  const u = new SpeechSynthesisUtterance(speakable(text));
  u.lang = lang;
  u.rate = o.rate ?? 1;
  u.pitch = 1;
  const v = pickVoice(synth.getVoices(), lang);
  if (v) { u.voice = v; u.lang = v.lang; }
  synth.speak(u);
  return u;
}

/** Name of the voice that would be used — shown in the UI so owners know what they're hearing. */
export function chosenVoiceName(lang = "en-GB"): string | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  return pickVoice(window.speechSynthesis.getVoices(), lang)?.name ?? null;
}
