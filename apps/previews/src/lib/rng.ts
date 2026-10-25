// Seeded PRNG so demo data is identical on every render, server and client.
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(r: () => number, xs: readonly T[]): T {
  return xs[Math.floor(r() * xs.length)];
}

export function weighted<T extends string>(r: () => number, w: Record<T, number>): T {
  const entries = Object.entries(w) as [T, number][];
  const total = entries.reduce((s, [, n]) => s + n, 0);
  let x = r() * total;
  for (const [k, n] of entries) {
    if ((x -= n) <= 0) return k;
  }
  return entries[entries.length - 1][0];
}
