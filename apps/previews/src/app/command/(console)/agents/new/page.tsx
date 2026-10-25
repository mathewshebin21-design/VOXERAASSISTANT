"use client";

import { clsx } from "clsx";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { Btn, Field, inputCls, PageHead, Panel, Slider, Toggle } from "@/components/command/ui";
import { SERVICES } from "@/lib/demo-data";
import { VOICES } from "@/lib/simulator";
import { DAY_KEYS, HoursEditor } from "@/components/shared/hours";
import { useWizard } from "@/lib/wizard";

export default function Wizard() {
  const w = useWizard();
  const router = useRouter();
  const { d, set } = w;
  return (
    <>
      <PageHead kicker={`Build · new agent · step ${w.step + 1}/${w.steps.length}`} title="Agent creation wizard" />
      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <ol className="flex gap-1 overflow-x-auto no-scrollbar lg:flex-col">
          {w.steps.map((s, i) => (
            <li key={s.id}>
              <button onClick={() => i <= w.step && w.setStep(i)} className={clsx("flex w-full items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm", i === w.step ? "bg-cmd-violet/15 text-cmd-text" : i < w.step ? "text-cmd-text hover:bg-cmd-raised" : "text-cmd-mute")}>
                <span className={clsx("grid h-5 w-5 place-items-center rounded-full border font-mono text-[10px]", i < w.step ? "border-cmd-ok bg-cmd-ok/20 text-cmd-ok" : i === w.step ? "border-cmd-violet text-cmd-violet" : "border-cmd-line")}>{i < w.step ? <Check size={11} /> : i + 1}</span>{s.title}
              </button>
            </li>
          ))}
        </ol>
        <Panel title={`${w.current.title} — ${w.current.blurb}`}>
          <div className="min-h-[320px] space-y-4">
            {w.current.id === "business" && <>
              <Field label="Business name"><input className={inputCls} value={d.businessName} onChange={(e) => set({ businessName: e.target.value })} /></Field>
              <Field label="Sector"><select className={inputCls} value={d.sector} onChange={(e) => set({ sector: e.target.value })}>{["Hair & beauty", "Aesthetics clinic", "Dental practice (planned)", "Physiotherapy (planned)", "Agency"].map((x) => <option key={x}>{x}</option>)}</select></Field>
              <Field label="Receptionist name"><input className={inputCls} value={d.agentName} onChange={(e) => set({ agentName: e.target.value })} /></Field>
              <Field label="Website" hint="Used only if you approve importing pages in the Knowledge step."><input className={inputCls} value={d.website} onChange={(e) => set({ website: e.target.value })} /></Field>
            </>}
            {w.current.id === "services" && <div className="grid gap-2 sm:grid-cols-2">
              {SERVICES.map((s) => {
                const on = d.serviceIds.includes(s.id);
                return <label key={s.id} className={clsx("flex items-center gap-3 rounded-md border px-3 py-2 text-sm", on ? "border-cmd-violet/60 bg-cmd-violet/5" : "border-cmd-line", !s.bookableByAgent && "opacity-50")}>
                  <input type="checkbox" disabled={!s.bookableByAgent} className="accent-[rgb(var(--cmd-violet))]" checked={on} onChange={() => set({ serviceIds: on ? d.serviceIds.filter((x) => x !== s.id) : [...d.serviceIds, s.id] })} />
                  <span className="flex-1">{s.name}{!s.bookableByAgent && <span className="block text-[11px] text-cmd-mute">staff-arranged</span>}</span><span className="font-mono text-[11px] text-cmd-mute">{s.durationMin}m · £{s.priceFromGBP}</span>
                </label>;
              })}
            </div>}
            {w.current.id === "hours" && <>
              <HoursEditor hours={d.hours} onChange={(h) => set({ hours: h })} theme="cmd" />
              <Field label="After hours"><select className={inputCls} value={d.afterHours} onChange={(e) => set({ afterHours: e.target.value as typeof d.afterHours })}><option value="answer_and_book">Answer and book future slots</option><option value="take_message">Take a message only</option><option value="voicemail">Voicemail</option></select></Field>
            </>}
            {w.current.id === "voice" && <>
              <Field label="Voice"><select className={inputCls} value={d.voiceId} onChange={(e) => set({ voiceId: e.target.value })}>{VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select></Field>
              <Field label="Greeting" hint="Must disclose AI identity."><textarea rows={3} className={inputCls} value={d.greeting} onChange={(e) => set({ greeting: e.target.value })} /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={`Warmth · ${d.warmth}`}><Slider label="Warmth" value={d.warmth} onChange={(n) => set({ warmth: n })} /></Field>
                <Field label={`Detail · ${d.verbosity}`}><Slider label="Detail" value={d.verbosity} onChange={(n) => set({ verbosity: n })} /></Field>
              </div>
            </>}
            {w.current.id === "knowledge" && <>
              <div className="flex items-center justify-between rounded-md border border-cmd-line px-3 py-2 text-sm"><span>Import approved pages from {d.website}</span><Toggle label="Import website" on={d.importWebsite} onChange={(b) => set({ importWebsite: b })} /></div>
              <p className="text-xs text-cmd-mute">Imported content is held as &quot;needs review&quot; until you verify it. Instructions found inside documents are treated as text, never as commands.</p>
              <Field label="Common questions (one per line)"><textarea rows={5} className={inputCls} value={d.faqs} onChange={(e) => set({ faqs: e.target.value })} /></Field>
            </>}
            {w.current.id === "safety" && <>
              <Field label="Transfer destination"><input className={inputCls} value={d.transferNumber} onChange={(e) => set({ transferNumber: e.target.value })} /></Field>
              <div className="flex items-center justify-between rounded-md border border-cmd-line px-3 py-2 text-sm"><span>Play recording notice at call start</span><Toggle label="Recording notice" on={d.recordingDisclosure} onChange={(b) => set({ recordingDisclosure: b })} /></div>
              <div className="flex items-center justify-between rounded-md border border-cmd-line px-3 py-2 text-sm"><span>Urgent alerts for safety concerns (always gives 999 / NHS 111 guidance)</span><Toggle label="Urgent alerts" on={d.urgentAlerts} onChange={(b) => set({ urgentAlerts: b })} /></div>
            </>}
            {w.current.id === "review" && <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {[["Business", d.businessName], ["Receptionist", d.agentName], ["Services", `${d.serviceIds.length} bookable`], ["Open days", DAY_KEYS.filter((k) => d.hours[k]).length + " per week"], ["Voice", VOICES.find((v) => v.id === d.voiceId)?.label], ["After hours", d.afterHours.replaceAll("_", " ")], ["Recording notice", d.recordingDisclosure ? "On" : "Off"], ["Transfer to", d.transferNumber]].map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-cmd-line py-1.5"><dt className="text-cmd-mute">{k}</dt><dd>{v}</dd></div>
              ))}
              <p className="col-span-full pt-2 text-xs text-cmd-mute">Finishing saves this as your draft configuration. Nothing goes live until you publish a version, and no phone number is connected in the preview.</p>
            </dl>}
            {w.errors[w.current.id] && <p className="text-sm text-cmd-bad" role="alert">{w.errors[w.current.id]}</p>}
          </div>
          <div className="mt-4 flex justify-between border-t border-cmd-line pt-4">
            <Btn onClick={w.back} disabled={w.step === 0}><ChevronLeft size={14} /> Back</Btn>
            {w.step < w.steps.length - 1
              ? <Btn variant="primary" onClick={w.next} disabled={!w.canNext}>Next <ChevronRight size={14} /></Btn>
              : <Btn variant="primary" onClick={() => { w.finish(); router.push("/command/simulator"); }}>Save draft & open simulator</Btn>}
          </div>
        </Panel>
      </div>
    </>
  );
}
