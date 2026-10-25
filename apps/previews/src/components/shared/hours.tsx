"use client";

import { clsx } from "clsx";
import { fmtTime } from "@/lib/time";
import type { OpeningHours } from "@/lib/types";

export const DAY_KEYS = [1, 2, 3, 4, 5, 6, 0];
const LABEL: Record<number, string> = { 0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat" };
const toMin = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };

const THEME = {
  cmd: { input: "rounded border border-cmd-line bg-cmd-bg px-2 py-1 font-mono text-xs", on: "accent-[rgb(var(--cmd-violet))]", row: "border-cmd-line", mute: "text-cmd-mute" },
  atl: { input: "rounded-full border border-atl-line bg-atl-paper px-3 py-1 text-sm", on: "accent-[rgb(var(--atl-champdeep))]", row: "border-atl-line", mute: "text-atl-soft" },
  flw: { input: "rounded-lg border border-flw-line bg-flw-bg px-2 py-1 font-mono text-xs text-flw-text", on: "accent-[rgb(var(--flw-cyan))]", row: "border-flw-line", mute: "text-flw-mute" },
};

/** Weekly opening-hours editor reused by every design's wizard, themed per design. */
export function HoursEditor({ hours, onChange, theme }: { hours: OpeningHours; onChange: (h: OpeningHours) => void; theme: keyof typeof THEME }) {
  const t = THEME[theme];
  return (
    <div className="space-y-1">
      {DAY_KEYS.map((k) => {
        const h = hours[k];
        return (
          <div key={k} className={clsx("flex flex-wrap items-center gap-3 border-b py-1.5 text-sm", t.row)}>
            <label className="flex w-20 items-center gap-2"><input type="checkbox" className={t.on} checked={!!h} onChange={() => onChange({ ...hours, [k]: h ? null : [540, 1080] })} />{LABEL[k]}</label>
            {h ? (
              <>
                <input aria-label={`${LABEL[k]} opens`} type="time" className={t.input} value={fmtTime(h[0])} onChange={(e) => onChange({ ...hours, [k]: [toMin(e.target.value), h[1]] })} />
                <span className={t.mute}>to</span>
                <input aria-label={`${LABEL[k]} closes`} type="time" className={t.input} value={fmtTime(h[1])} onChange={(e) => onChange({ ...hours, [k]: [h[0], toMin(e.target.value)] })} />
              </>
            ) : <span className={t.mute}>Closed</span>}
          </div>
        );
      })}
    </div>
  );
}
