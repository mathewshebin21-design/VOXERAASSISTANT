"use client";

import { clsx } from "clsx";
import { Play } from "lucide-react";
import { useEffect, useState } from "react";
import { Chip, FBtn } from "./ui";
import { KOKORO_VOICES, kokoro, kokoroSupported, previewKokoro, type KokoroProgress } from "@/lib/voice/kokoro";

export type VoiceChoice = { engine: "browser" } | { engine: "kokoro"; id: string };

const SAMPLE = "Hello, you're through to the salon. I'm the AI receptionist — how can I help today?";
const mb = (n: number) => `${(n / 1_048_576).toFixed(0)} MB`;

/** Choose the agent's voice: the browser's own, or a downloadable open-source Kokoro voice. */
export function VoicePicker({ value, onChange, disabled }: { value: VoiceChoice; onChange: (v: VoiceChoice) => void; disabled?: boolean }) {
  const [progress, setProgress] = useState<KokoroProgress>({ state: "idle", loaded: 0, total: 0 });
  const [supported, setSupported] = useState(false);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [genMs, setGenMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setSupported(kokoroSupported()); return kokoro().onProgress(setProgress); }, []);
  const selected = value.engine === "kokoro" ? value.id : null;

  const preview = async (id: string) => {
    setPreviewing(id); setError(null);
    try { setGenMs(Math.round(await previewKokoro(id, SAMPLE))); }
    catch (e) { setError(e instanceof Error ? e.message : "Preview failed"); }
    finally { setPreviewing(null); }
  };

  return (
    <div className={clsx("space-y-2", disabled && "pointer-events-none opacity-50")}>
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Voice engine">
        <span className="text-sm">Voice</span>
        <button type="button" role="radio" aria-checked={value.engine === "browser"} onClick={() => onChange({ engine: "browser" })} className={clsx("rounded-lg border px-2.5 py-1 text-xs", value.engine === "browser" ? "border-flw-cyan text-flw-cyan" : "border-flw-line text-flw-mute")}>Browser voice</button>
        <button type="button" role="radio" aria-checked={value.engine === "kokoro"} disabled={!supported} onClick={() => onChange({ engine: "kokoro", id: selected ?? "bf_emma" })} className={clsx("rounded-lg border px-2.5 py-1 text-xs disabled:opacity-40", value.engine === "kokoro" ? "border-flw-cyan text-flw-cyan" : "border-flw-line text-flw-mute")}>Kokoro · free, on device</button>
      </div>
      {value.engine === "kokoro" && (
        <div className="rounded-xl border border-flw-line/70 bg-flw-bg/40 p-2">
          <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2" aria-label="Kokoro voices">
            {KOKORO_VOICES.map((v) => (
              <li key={v.id} className={clsx("flex items-center gap-2 rounded-lg px-2 py-1 text-xs", selected === v.id ? "bg-flw-violet/15" : "hover:bg-flw-surface/60")}>
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                  <input type="radio" name="kokoro-voice" checked={selected === v.id} onChange={() => onChange({ engine: "kokoro", id: v.id })} aria-label={`${v.name}, ${v.accent} ${v.gender}`} className="accent-[rgb(var(--flw-cyan))]" />
                  <span className="truncate">{v.name}</span>
                  <span className="text-flw-mute">{v.accent === "British" ? "🇬🇧" : "🇺🇸"} {v.gender === "female" ? "F" : "M"}</span>
                  <span className="ml-auto font-mono text-[10px] text-flw-mute" title="Model card's overall grade">{v.grade}</span>
                </label>
                <button type="button" onClick={() => void preview(v.id)} disabled={!!previewing} aria-label={`Preview ${v.name}`} className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-flw-line text-flw-mute hover:text-flw-text disabled:opacity-40"><Play size={10} /></button>
              </li>
            ))}
          </ul>
          <div className="mt-2 text-[11px] text-flw-mute" data-testid="kokoro-status">
            {progress.state === "loading" ? <>Downloading the voice model… {progress.total ? `${mb(progress.loaded)} of ${mb(progress.total)}` : ""}</>
              : progress.state === "ready" ? <>Voice model ready{genMs !== null && <> · last sample generated in {genMs} ms</>}</>
              : progress.state === "error" ? <span className="text-flw-pink">Couldn’t load the voice model: {progress.error}</span>
              : <>The first use downloads the model once (about 92 MB) from Hugging Face; it then runs entirely in your browser.</>}
            {previewing && <span> · preparing sample…</span>}
          </div>
          {progress.state === "loading" && progress.total > 0 && <div className="mt-1 h-1 overflow-hidden rounded-full bg-flw-line/60"><div className="h-full bg-flw-cyan" style={{ width: `${Math.round((progress.loaded / progress.total) * 100)}%` }} /></div>}
          {error && <p role="alert" className="mt-1 text-[11px] text-flw-pink">{error}</p>}
          <div className="mt-2 flex items-center gap-2 text-[10px] text-flw-mute"><Chip tone="lime">Apache-2.0</Chip> open-weight model Kokoro-82M · grades from its model card</div>
        </div>
      )}
      {value.engine === "kokoro" && progress.state === "idle" && <FBtn type="button" onClick={() => void kokoro().load().catch(() => undefined)} className="text-xs">Download voice model now</FBtn>}
    </div>
  );
}
