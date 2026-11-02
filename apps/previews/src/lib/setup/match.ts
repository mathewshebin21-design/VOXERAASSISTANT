// Working out which service an owner means from what they typed: "kids cut" for
// "Kids' cut (under 12)", "hot towel shave" for "Hot towel cut-throat shave".

/** Comparable form of a service name: "Kids' Cuts & Shapes" ≈ "kid cut and shape". */
export const key = (s: string) =>
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
