"use client";

import { Play, RotateCcw, Upload } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { FlowCanvas } from "@/components/flow/canvas";
import { Chip, FBtn, finput, FSwitch, Glass, GHead } from "@/components/flow/ui";
import { FLOW_NODES } from "@/lib/flow-graph";
import { LANGUAGES, VOICES } from "@/lib/simulator";
import { usePreview } from "@/lib/store";

const TOOL_SCHEMAS: Record<string, object> = {
  check_availability: { service_id: "string (enum: enabled services)", from_date: "YYYY-MM-DD", days: "1–14", after: "minutes?", before: "minutes?" },
  create_booking: { service_id: "string", staff_id: "string", date: "YYYY-MM-DD", start: "HH:MM", customer_name: "string", confirmed_by_caller: "true (required)", idempotency_key: "string" },
  search_knowledge: { query: "string", min_score: 0.35, status: "verified only" },
  transfer_call: { destination: "configured target", summary_for_staff: "string" },
  take_message: { topic: "string", callback: "caller number" },
};

const BOOKING_NODES = ["book", "slots", "details", "confirm", "booked"];

export default function Canvas() {
  const s = usePreview();
  const p = s.draft.persona;
  const [sel, setSel] = useState("persona");
  const [note, setNote] = useState("");
  const node = FLOW_NODES.find((n) => n.id === sel)!;
  const disabled = [...(p.allowBooking ? [] : BOOKING_NODES), ...(p.allowTransfer ? [] : ["transfer"])];
  const live = s.published.at(-1)!;
  const dirty = JSON.stringify(live.config) !== JSON.stringify(s.draft);

  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_380px]">
      <div className="relative">
        <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-2">
          <Chip tone="violet">{p.agentName} · draft</Chip>
          <Chip tone="mute">live v{live.version}</Chip>
          {dirty && <Chip tone="amber">unpublished changes</Chip>}
        </div>
        <FlowCanvas selected={sel} onSelect={setSel} disabled={disabled} height="calc(100vh - 120px)" />
        <p className="mt-2 px-1 font-mono text-[10px] text-flw-mute">Drag to pan, scroll to zoom, click a node to inspect. The graph mirrors the simulator&apos;s logic; editing the graph structure itself is planned for Phase 9.</p>
      </div>
      <div className="space-y-3">
        <Glass glow="cyan">
          <GHead title={node.label} right={<Chip tone="cyan">{node.kind}</Chip>} />
          <div className="space-y-4 p-4">
            <p className="text-sm text-flw-mute">{node.detail}</p>
            {node.id === "persona" && <>
              <label className="block text-xs text-flw-mute">Name<input className={finput + " mt-1"} value={p.agentName} onChange={(e) => s.setPersona({ agentName: e.target.value })} /></label>
              <label className="block text-xs text-flw-mute">Greeting (must disclose AI)<textarea rows={3} className={finput + " mt-1"} value={p.greeting} onChange={(e) => s.setPersona({ greeting: e.target.value })} /></label>
              {!/\bAI\b/i.test(p.greeting) && <p className="text-xs text-flw-pink">AI disclosure missing — publishing would be blocked.</p>}
              <label className="block text-xs text-flw-mute">Voice<select className={finput + " mt-1"} value={s.draft.voiceId} onChange={(e) => s.setDraft({ voiceId: e.target.value })}>{VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select></label>
              <label className="block text-xs text-flw-mute">Language<select className={finput + " mt-1"} value={s.draft.language} onChange={(e) => s.setDraft({ language: e.target.value })}>{LANGUAGES.map((l) => <option key={l} disabled={l.includes("planned")}>{l}</option>)}</select></label>
              {([["Warmth", "warmth"], ["Detail", "verbosity"]] as const).map(([l, k]) => (
                <label key={k} className="block text-xs text-flw-mute">{l} · {p[k]}<input type="range" className="mt-1 w-full accent-[rgb(var(--flw-cyan))]" value={p[k]} onChange={(e) => s.setPersona({ [k]: Number(e.target.value) })} /></label>
              ))}
              <label className="block text-xs text-flw-mute">Pace · {s.draft.speakingRate.toFixed(2)}×<input type="range" min={0.8} max={1.2} step={0.05} className="mt-1 w-full accent-[rgb(var(--flw-cyan))]" value={s.draft.speakingRate} onChange={(e) => s.setDraft({ speakingRate: Number(e.target.value) })} /></label>
            </>}
            {node.id === "greet" && <div className="flex items-center justify-between text-sm">Recording notice<FSwitch label="Recording notice" on={p.recordingDisclosure} onChange={(b) => s.setPersona({ recordingDisclosure: b })} /></div>}
            {BOOKING_NODES.includes(node.id) && <div className="flex items-center justify-between text-sm">Booking tools enabled<FSwitch label="Booking tools" on={p.allowBooking} onChange={(b) => s.setPersona({ allowBooking: b })} /></div>}
            {node.id === "transfer" && <>
              <div className="flex items-center justify-between text-sm">Transfers enabled<FSwitch label="Transfers" on={p.allowTransfer} onChange={(b) => s.setPersona({ allowTransfer: b })} /></div>
              <label className="block text-xs text-flw-mute">Destination<input className={finput + " mt-1"} value={p.transferTarget} onChange={(e) => s.setPersona({ transferTarget: e.target.value })} /></label>
            </>}
            {node.id === "confirm" && <p className="rounded-xl border border-flw-amber/30 bg-flw-amber/5 p-3 text-xs text-flw-amber">Locked rule: create_booking is only callable with confirmed_by_caller = true after the read-back.</p>}
            {(node.id === "guard" || node.id === "escalate" || node.id === "fallback") && <p className="rounded-xl border border-flw-amber/30 bg-flw-amber/5 p-3 text-xs text-flw-amber">Safety node — always on. It can be tested in Simulate but not disabled.</p>}
            {node.tool && TOOL_SCHEMAS[node.tool] && (
              <div><div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-flw-mute">tool contract · {node.tool}</div>
                <pre className="overflow-x-auto rounded-xl bg-flw-bg/80 p-3 font-mono text-[11px] text-flw-cyan">{JSON.stringify(TOOL_SCHEMAS[node.tool], null, 2)}</pre>
                <p className="mt-1 text-[11px] text-flw-mute">Arguments are validated server-side before execution (Phase 5).</p></div>
            )}
            <Link href="/flow/app/simulate"><FBtn className="w-full"><Play size={14} /> Test this flow</FBtn></Link>
          </div>
        </Glass>
        <Glass>
          <GHead title="Publish" />
          <div className="space-y-3 p-4">
            <input aria-label="Change note" className={finput} placeholder="Describe the change" value={note} onChange={(e) => setNote(e.target.value)} />
            <FBtn variant="glow" className="w-full" disabled={!dirty || !note.trim()} onClick={() => { s.publish(note); setNote(""); }}><Upload size={14} /> Publish version</FBtn>
            <ul className="max-h-48 space-y-1 overflow-y-auto">
              {[...s.published].reverse().map((v, i) => (
                <li key={v.version} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-flw-surface">
                  <span className="font-mono text-xs text-flw-violet">v{v.version}</span><span className="flex-1 truncate">{v.note}</span>
                  {i === 0 ? <Chip tone="lime">live</Chip> : <button onClick={() => s.rollback(v.version)} className="text-flw-mute hover:text-flw-cyan" aria-label={`Roll back to v${v.version}`}><RotateCcw size={13} /></button>}
                </li>
              ))}
            </ul>
          </div>
        </Glass>
      </div>
    </div>
  );
}
