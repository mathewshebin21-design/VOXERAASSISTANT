"use client";

import { clsx } from "clsx";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { FlowCanvas } from "@/components/flow/canvas";
import { HoursEditor } from "@/components/shared/hours";
import { Chip, FBtn, finput, FSwitch, Glass, GHead, Heading } from "@/components/flow/ui";
import { SERVICES } from "@/lib/demo-data";
import { VOICES } from "@/lib/simulator";
import { useWizard } from "@/lib/wizard";
import { api, ApiError, PERMS } from "@/lib/live/api";
import { useActiveOrg } from "@/lib/live/session";
import { useState } from "react";

// Which flow nodes each wizard step "generates" in the live preview.
const UNLOCK = [["persona", "greet"], ["intent", "book"], ["slots", "details", "confirm", "booked"], ["guard"], ["kb", "fallback"], ["escalate", "transfer", "message"], ["end"]];

export default function NewAgent() {
  const active = useActiveOrg();
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const w = useWizard();
  const router = useRouter();
  const { d, set } = w;
  const id = w.current.id;
  const unlocked = UNLOCK.slice(0, w.step + 1).flat();
  return (
    <>
      <Heading kicker={`Generate agent · ${w.step + 1}/${w.steps.length}`} title="Compose a new receptionist"><Chip tone="amber">draft only · nothing goes live</Chip></Heading>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[440px_1fr]">
        <Glass>
          <div className="no-scrollbar flex gap-1 overflow-x-auto border-b border-flw-line/70 p-2">
            {w.steps.map((s, i) => (
              <button key={s.id} onClick={() => i <= w.step && w.setStep(i)} className={clsx("flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs", i === w.step ? "bg-flw-violet/20 text-flw-violet" : i < w.step ? "text-flw-text" : "text-flw-mute")}>
                {i < w.step ? <Check size={12} className="text-flw-lime" /> : <span className="font-mono">{i + 1}</span>}{s.title}
              </button>
            ))}
          </div>
          <div className="min-h-[380px] space-y-4 p-5">
            <div><div className="font-display text-lg font-medium">{w.current.title}</div><div className="text-sm text-flw-mute">{w.current.blurb}</div></div>
            {id === "business" && <>
              <label className="block text-xs text-flw-mute">Business<input className={finput + " mt-1"} value={d.businessName} onChange={(e) => set({ businessName: e.target.value })} /></label>
              <label className="block text-xs text-flw-mute">Agent name<input className={finput + " mt-1"} value={d.agentName} onChange={(e) => set({ agentName: e.target.value })} /></label>
              <label className="block text-xs text-flw-mute">Website<input className={finput + " mt-1"} value={d.website} onChange={(e) => set({ website: e.target.value })} /></label>
            </>}
            {id === "services" && <div className="flex flex-wrap gap-2">{SERVICES.map((s) => {
              const on = d.serviceIds.includes(s.id);
              return <button key={s.id} disabled={!s.bookableByAgent} aria-pressed={on} onClick={() => set({ serviceIds: on ? d.serviceIds.filter((x) => x !== s.id) : [...d.serviceIds, s.id] })} className={clsx("rounded-xl border px-3 py-1.5 text-sm", on ? "border-flw-cyan bg-flw-cyan/10 text-flw-cyan" : "border-flw-line text-flw-mute", !s.bookableByAgent && "opacity-40")}>{s.name}</button>;
            })}</div>}
            {id === "hours" && <><HoursEditor hours={d.hours} onChange={(h) => set({ hours: h })} theme="flw" />
              <label className="block text-xs text-flw-mute">After hours<select className={finput + " mt-1"} value={d.afterHours} onChange={(e) => set({ afterHours: e.target.value as typeof d.afterHours })}><option value="answer_and_book">Answer & book</option><option value="take_message">Message only</option><option value="voicemail">Voicemail</option></select></label></>}
            {id === "voice" && <>
              <label className="block text-xs text-flw-mute">Voice<select className={finput + " mt-1"} value={d.voiceId} onChange={(e) => set({ voiceId: e.target.value })}>{VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select></label>
              <label className="block text-xs text-flw-mute" htmlFor="flw-greeting">Greeting — must disclose AI</label>
              <textarea id="flw-greeting" rows={3} className={finput} value={d.greeting} onChange={(e) => set({ greeting: e.target.value })} />
              <label className="block text-xs text-flw-mute">Warmth · {d.warmth}<input type="range" className="mt-1 w-full accent-[rgb(var(--flw-cyan))]" value={d.warmth} onChange={(e) => set({ warmth: Number(e.target.value) })} /></label>
              <label className="block text-xs text-flw-mute">Detail · {d.verbosity}<input type="range" className="mt-1 w-full accent-[rgb(var(--flw-cyan))]" value={d.verbosity} onChange={(e) => set({ verbosity: Number(e.target.value) })} /></label>
            </>}
            {id === "knowledge" && <>
              <div className="flex items-center justify-between rounded-xl border border-flw-line p-3 text-sm">Crawl approved website pages<FSwitch label="Import website" on={d.importWebsite} onChange={(b) => set({ importWebsite: b })} /></div>
              <label className="block text-xs text-flw-mute">Seed questions<textarea rows={4} className={finput + " mt-1"} value={d.faqs} onChange={(e) => set({ faqs: e.target.value })} /></label>
              <p className="text-[11px] text-flw-mute">Imported text is screened for prompt-injection and held for review.</p>
            </>}
            {id === "safety" && <>
              <label className="block text-xs text-flw-mute">Transfer destination<input className={finput + " mt-1"} value={d.transferNumber} onChange={(e) => set({ transferNumber: e.target.value })} /></label>
              <div className="flex items-center justify-between rounded-xl border border-flw-line p-3 text-sm">Recording notice<FSwitch label="Recording notice" on={d.recordingDisclosure} onChange={(b) => set({ recordingDisclosure: b })} /></div>
              <div className="flex items-center justify-between rounded-xl border border-flw-line p-3 text-sm">Urgent safety alerts<FSwitch label="Urgent alerts" on={d.urgentAlerts} onChange={(b) => set({ urgentAlerts: b })} /></div>
            </>}
            {id === "review" && <ul className="space-y-1.5 font-mono text-xs">
              {[["agent", d.agentName], ["business", d.businessName], ["services", d.serviceIds.length], ["voice", d.voiceId], ["after_hours", d.afterHours], ["recording_notice", String(d.recordingDisclosure)], ["nodes", unlocked.length]].map(([k, v]) => <li key={String(k)} className="flex justify-between border-b border-flw-line/60 py-1"><span className="text-flw-mute">{k}</span><span>{v}</span></li>)}
            </ul>}
            {w.errors[id] && <p role="alert" className="text-sm text-flw-pink">{w.errors[id]}</p>}
            {saveErr && <p role="alert" className="text-sm text-flw-pink">{saveErr}</p>}
            {active && id === "review" && <p className="text-xs text-flw-mute">Signed in: finishing saves this agent to <span className="text-flw-text">{active.organization.name}</span>.</p>}
          </div>
          <div className="flex justify-between border-t border-flw-line/70 p-4">
            <FBtn onClick={w.back} disabled={w.step === 0}><ArrowLeft size={14} /> Back</FBtn>
            {w.step < w.steps.length - 1 ? <FBtn variant="glow" onClick={w.next} disabled={!w.canNext}>Next <ArrowRight size={14} /></FBtn>
              : <FBtn variant="glow" onClick={async () => {
                  w.finish();
                  // Signed in: also save the agent to the workspace (the API re-validates AI disclosure).
                  if (active && PERMS[active.role].write) {
                    try {
                      await api(`/orgs/${active.organization.id}/agents`, { method: "POST", body: { name: d.agentName, greeting: d.greeting.replace("{business}", d.businessName).replace("{agent}", d.agentName), voice_id: d.voiceId, language: "en-GB" } });
                    } catch (e) { setSaveErr(e instanceof ApiError ? e.detail : "Could not save the agent"); return; }
                  }
                  router.push(active ? "/flow/app/agent" : "/flow/app/simulate");
                }}>{active ? "Save to workspace" : "Save & simulate"}</FBtn>}
          </div>
        </Glass>
        <Glass>
          <GHead title="Generated flow — live preview" right={<span className="font-mono text-xs text-flw-mute">{unlocked.length} nodes</span>} />
          <div className="p-3"><FlowCanvas visited={unlocked} active={UNLOCK[w.step].at(-1)} disabled={[]} height={520} interactive={false} /></div>
        </Glass>
      </div>
    </>
  );
}
