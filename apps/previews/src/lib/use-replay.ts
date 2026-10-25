"use client";

import { useEffect, useState } from "react";
import { CALLS, transcriptFor } from "./demo-data";
import type { CallRecord, TranscriptTurn } from "./types";

export interface ReplayLane {
  call: CallRecord;
  turns: TranscriptTurn[];
  elapsed: number;
  visible: TranscriptTurn[];
  current?: TranscriptTurn;
  done: boolean;
}

// Pick a varied, deterministic set of calls to replay as "live" activity.
const POOL = ["booked", "answered_question", "transferred", "rescheduled", "message_taken", "failed"]
  .map((o) => CALLS.find((c) => c.outcome === o && c.status === "answered"))
  .filter(Boolean) as CallRecord[];

/**
 * Replays recorded demo transcripts on a clock to imitate concurrent live calls.
 * Clearly a replay: no audio, no telephony.
 */
export function useReplay(lanes = 3, speed = 1.6) {
  const [tick, setTick] = useState(0);
  const [offsets] = useState(() => Array.from({ length: lanes }, (_, i) => i * 17));
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 250);
    return () => clearInterval(t);
  }, []);
  return Array.from({ length: lanes }, (_, i): ReplayLane => {
    const seconds = (tick / 4) * speed + offsets[i];
    const cycle = POOL.map((c) => ({ c, t: transcriptFor(c) }));
    const lens = cycle.map(({ t }) => (t.at(-1)?.at ?? 10) + 8);
    const total = lens.reduce((a, b) => a + b, 0);
    let s = seconds % total;
    let idx = (i * 2) % cycle.length;
    // walk the cycle starting from a lane-specific call
    for (let k = 0; k < cycle.length; k++) {
      const j = (idx + k) % cycle.length;
      if (s < lens[j]) { idx = j; break; }
      s -= lens[j];
    }
    const { c, t } = cycle[idx];
    const visible = t.filter((x) => x.at <= s);
    return { call: c, turns: t, elapsed: s, visible, current: visible.at(-1), done: s > (t.at(-1)?.at ?? 0) + 2 };
  });
}
