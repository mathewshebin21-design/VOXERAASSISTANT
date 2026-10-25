// Knowledge utilities for the previews: lexical retrieval, prompt-injection
// screening and simple conflict detection. Phase 6 replaces retrieval with a
// hybrid (BM25 + embeddings) index, but keeps these contracts and tests.

import type { KnowledgeEntry } from "./types";

const STOP = new Set("a an and are at be by can do does for from have how i in is it me my of on or our the to we what when where which with you your".split(" "));

// Small synonym map so caller phrasing reaches the right entry ("how much" → price).
const SYN: Record<string, string> = { much: "price", cost: "price", charge: "price", kid: "children", child: "children", close: "hour", open: "hour", time: "hour", late: "cancel", car: "park" };

const stem = (w: string) => (w.length > 4 && w.endsWith("ing") ? w.slice(0, -3) : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

export const tokens = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9£ ]/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w)).map(stem).map((w) => SYN[w] ?? w);

export interface Hit { entry: KnowledgeEntry; score: number; matched: string[] }

/** BM25-flavoured lexical scoring over title + body. Scores are normalised to 0–1. */
export function retrieve(query: string, entries: KnowledgeEntry[], k = 3): Hit[] {
  const q = [...new Set(tokens(query))];
  if (!q.length) return [];
  const docs = entries.map((e) => tokens(`${e.title} ${e.title} ${e.body}`));
  const avg = docs.reduce((s, d) => s + d.length, 0) / Math.max(1, docs.length);
  const df = (t: string) => docs.filter((d) => d.includes(t)).length;
  const raw = entries.map((entry, i) => {
    const d = docs[i];
    let score = 0;
    const matched: string[] = [];
    for (const t of q) {
      const tf = d.filter((w) => w === t).length;
      if (!tf) continue;
      matched.push(t);
      const idf = Math.log(1 + (entries.length - df(t) + 0.5) / (df(t) + 0.5));
      score += idf * ((tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (d.length / avg))));
    }
    return { entry, score, matched };
  });
  const max = Math.max(...raw.map((r) => r.score), 1e-9);
  return raw.filter((r) => r.score > 0).map((r) => ({ ...r, score: +(r.score / max * Math.min(1, r.matched.length / q.length + 0.2)).toFixed(2) })).sort((a, b) => b.score - a.score).slice(0, k);
}

const INJECTION = [
  /ignore (all |any |the )?(previous|prior|above|earlier) (instructions|rules|messages)/i,
  /you are (now )?(a|an|the) /i,
  /system prompt/i,
  /disregard (your|the) (rules|guidelines|instructions)/i,
  /(reveal|print|output) (the |your )?(prompt|instructions|customer|client) ?(list|data)?/i,
  /<\s*\/?\s*(system|assistant|instructions?)\s*>/i,
];

/** Flags text that tries to instruct the model. Flagged content is quarantined, never executed. */
export function scanInjection(text: string): string[] {
  return INJECTION.filter((re) => re.test(text)).map((re) => text.match(re)![0]);
}

/** Entries that mention the same topic but quote different £ amounts. */
export function detectConflicts(entries: KnowledgeEntry[], topics = ["deposit", "cancel", "patch", "parking", "children"]): { topic: string; ids: string[]; amounts: string[] }[] {
  const out: { topic: string; ids: string[]; amounts: string[] }[] = [];
  for (const topic of topics) {
    const hits = entries.filter((e) => `${e.title} ${e.body}`.toLowerCase().includes(topic));
    const amounts = new Map<string, string>();
    for (const h of hits) {
      const m = h.body.match(/£\s?\d+(\.\d+)?/g);
      if (m) amounts.set(h.id, m.join("/"));
    }
    if (new Set(amounts.values()).size > 1) out.push({ topic, ids: [...amounts.keys()], amounts: [...amounts.values()] });
  }
  return out;
}
