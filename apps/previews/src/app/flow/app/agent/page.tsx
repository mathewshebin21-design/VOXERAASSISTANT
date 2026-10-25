"use client";

import { clsx } from "clsx";
import { GitCommit, Play, RotateCcw, Upload } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Chip, FBtn, finput, FSwitch, Glass, GHead, Heading } from "@/components/flow/ui";
import { APPOINTMENTS, SERVICES } from "@/lib/demo-data";
import { initialState, LANGUAGES, respond, VOICES } from "@/lib/simulator";
import { usePreview } from "@/lib/store";

const TABS = ["Voice & persona", "Behaviour", "Services", "Escalation", "Privacy", "Versions"] as const;
const SAMPLES = ["How much is balayage?", "Where can I park?", "What's your cancellation policy?"];

export default function Agent() {
  const s = usePreview();
  const p = s.draft.persona;
  const [tab, setTab] = useState<(typeof TABS)[number]>("Voice & persona");
  const [sample, setSample] = useState(SAMPLES[0]);
  const [note, setNote] = useState("");
  const live = s.published.at(-1)!;
  const dirty = JSON.stringify(live.config) !== JSON.stringify(s.draft);
  // "Hear the difference": re-runs the simulator so persona changes are visible immediately.
  const reply = useMemo(() => respond(sample, initialState(), { persona: p, knowledge: s.knowledge, appointments: APPOINTMENTS }).events.filter((e) => e.kind === "agent").map((e) => (e as { text: string }).text).join(" "), [sample, p, s.knowledge]);
  const speak = (text: string, lang = "en-GB") => {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang; u.rate = s.draft.speakingRate;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  };
  const greeting = p.greeting.replace("{business}", p.businessName).replace("{agent}", p.agentName);

  return (
    <>
      <Heading kicker="Agent" title={`${p.agentName} — configuration`}>
        <Link href="/flow/app/new"><FBtn>New agent wizard</FBtn></Link>
        <Link href="/flow/app/simulate"><FBtn><Play size={14} /> Simulate</FBtn></Link>
      </Heading>
      <Glass className="mb-4 flex flex-wrap items-center gap-3 p-4">
        <Chip tone="lime">live v{live.version}</Chip>
        <span className="text-sm text-flw-mute">published {live.publishedAt} · {live.note}</span>
        {dirty ? <Chip tone="amber">unpublished changes</Chip> : <Chip>draft = live</Chip>}
        <div className="flex w-full gap-2 sm:ml-auto sm:w-auto">
          <input aria-label="Change note" className={finput + " sm:w-64"} placeholder="Change note (required)" value={note} onChange={(e) => setNote(e.target.value)} />
          <FBtn variant="glow" disabled={!dirty || !note.trim()} onClick={() => { s.publish(note); setNote(""); }}><Upload size={14} /> Publish</FBtn>
        </div>
      </Glass>
      <div className="no-scrollbar mb-4 flex gap-1 overflow-x-auto" role="tablist">
        {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={clsx("whitespace-nowrap rounded-xl px-3.5 py-2 text-sm", tab === t ? "bg-flw-violet/20 text-flw-violet" : "text-flw-mute hover:text-flw-text")}>{t}</button>)}
      </div>

      {tab === "Voice & persona" && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Glass>
            <GHead title="Persona" />
            <div className="space-y-4 p-4">
              <label className="block text-xs text-flw-mute">Name<input className={finput + " mt-1"} value={p.agentName} onChange={(e) => s.setPersona({ agentName: e.target.value })} /></label>
              <label className="block text-xs text-flw-mute">Greeting — use {"{business}"} and {"{agent}"}; must disclose AI<textarea rows={3} className={finput + " mt-1"} value={p.greeting} onChange={(e) => s.setPersona({ greeting: e.target.value })} /></label>
              {!/\bAI\b/i.test(p.greeting) && <p className="text-xs text-flw-pink">AI disclosure missing — publishing would be blocked in production.</p>}
              <label className="block text-xs text-flw-mute">Language<select className={finput + " mt-1"} value={s.draft.language} onChange={(e) => s.setDraft({ language: e.target.value })}>{LANGUAGES.map((l) => <option key={l} disabled={l.includes("planned")}>{l}</option>)}</select></label>
              {([["Warmth", "warmth"], ["Detail", "verbosity"]] as const).map(([l, k]) => (
                <label key={k} className="block text-xs text-flw-mute">{l} · {p[k]}<input type="range" className="mt-1 w-full accent-[rgb(var(--flw-cyan))]" value={p[k]} onChange={(e) => s.setPersona({ [k]: Number(e.target.value) })} /></label>
              ))}
              <label className="block text-xs text-flw-mute">Speaking rate · {s.draft.speakingRate.toFixed(2)}×<input type="range" min={0.8} max={1.2} step={0.05} className="mt-1 w-full accent-[rgb(var(--flw-cyan))]" value={s.draft.speakingRate} onChange={(e) => s.setDraft({ speakingRate: Number(e.target.value) })} /></label>
            </div>
          </Glass>
          <div className="space-y-4">
            <Glass glow="cyan">
              <GHead title="Hear the difference" right={<Chip tone="cyan">live preview</Chip>} />
              <div className="p-4">
                <div className="flex flex-wrap gap-2">{SAMPLES.map((x) => <button key={x} onClick={() => setSample(x)} className={clsx("rounded-xl border px-3 py-1.5 text-xs", sample === x ? "border-flw-cyan text-flw-cyan" : "border-flw-line text-flw-mute")}>{x}</button>)}</div>
                <p className="mt-4 text-xs text-flw-mute">Caller: “{sample}”</p>
                <p className="mt-1 font-display text-lg leading-snug">“{reply}”</p>
                <FBtn className="mt-4" onClick={() => speak(reply)}><Play size={14} /> Play (browser voice)</FBtn>
                <p className="mt-2 text-[11px] text-flw-mute">Answers come from Knowledge; the browser voice stands in for the production TTS voice.</p>
              </div>
            </Glass>
            <Glass>
              <GHead title="Voice" />
              <ul>{VOICES.map((v) => (
                <li key={v.id} className="flex items-center gap-3 border-t border-flw-line/60 px-4 py-2.5 first:border-0">
                  <input type="radio" name="voice" aria-label={v.label} className="accent-[rgb(var(--flw-cyan))]" checked={s.draft.voiceId === v.id} onChange={() => s.setDraft({ voiceId: v.id })} />
                  <span className="flex-1 text-sm">{v.label}</span><span className="font-mono text-[10px] text-flw-mute">{v.accent} · {v.pace}</span>
                  <button onClick={() => speak(greeting, v.accent)} aria-label={`Preview ${v.label}`} className="text-flw-mute hover:text-flw-cyan"><Play size={14} /></button>
                </li>
              ))}</ul>
            </Glass>
          </div>
        </div>
      )}

      {tab === "Behaviour" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Glass>
            <GHead title="Tool permissions" />
            <div className="divide-y divide-flw-line/60">
              <div className="flex items-center justify-between p-4 text-sm">Book, move & cancel appointments<FSwitch label="Booking" on={p.allowBooking} onChange={(b) => s.setPersona({ allowBooking: b })} /></div>
              <div className="flex items-center justify-between p-4 text-sm">Transfer calls to staff<FSwitch label="Transfers" on={p.allowTransfer} onChange={(b) => s.setPersona({ allowTransfer: b })} /></div>
              <label className="block p-4 text-xs text-flw-mute">Transfer destination<input className={finput + " mt-1"} value={p.transferTarget} onChange={(e) => s.setPersona({ transferTarget: e.target.value })} /></label>
            </div>
          </Glass>
          <Glass>
            <GHead title="After hours" />
            <div className="space-y-2 p-4">
              {([["answer_and_book", "Answer and book future slots"], ["take_message", "Answer, take a message only"], ["voicemail", "Send to voicemail"]] as const).map(([k, l]) => (
                <label key={k} className="flex items-center gap-3 rounded-xl border border-flw-line px-3 py-2.5 text-sm"><input type="radio" name="after" className="accent-[rgb(var(--flw-cyan))]" checked={s.draft.afterHours === k} onChange={() => s.setDraft({ afterHours: k })} />{l}</label>
              ))}
            </div>
          </Glass>
        </div>
      )}

      {tab === "Services" && (
        <Glass>
          <GHead title="Bookable services" right={<span className="text-xs text-flw-mute">greyed = staff-arranged</span>} />
          <div className="grid grid-cols-1 gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {SERVICES.map((svc) => {
              const on = s.draft.enabledServiceIds.includes(svc.id) && svc.bookableByAgent;
              return (
                <label key={svc.id} className={clsx("flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm", !svc.bookableByAgent ? "border-flw-line opacity-40" : on ? "border-flw-cyan bg-flw-cyan/5" : "border-flw-line")}>
                  <input type="checkbox" disabled={!svc.bookableByAgent} className="accent-[rgb(var(--flw-cyan))]" checked={on} onChange={() => s.setDraft({ enabledServiceIds: on ? s.draft.enabledServiceIds.filter((x) => x !== svc.id) : [...s.draft.enabledServiceIds, svc.id] })} />
                  <span className="flex-1">{svc.name}</span><span className="font-mono text-[11px] text-flw-mute">{svc.durationMin}m · £{svc.priceFromGBP}</span>
                </label>
              );
            })}
          </div>
        </Glass>
      )}

      {tab === "Escalation" && (
        <Glass>
          <GHead title="Escalation rules" />
          <ul>{s.draft.escalation.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 border-t border-flw-line/60 px-4 py-3 text-sm first:border-0">
              <span className="min-w-0 flex-1">When {r.when.toLowerCase()} →</span>
              <select aria-label={`Action for ${r.when}`} className={finput + " w-auto"} value={r.action} onChange={(e) => s.setDraft({ escalation: s.draft.escalation.map((x) => x.id === r.id ? { ...x, action: e.target.value as typeof r.action } : x) })}>
                <option value="transfer">Warm transfer</option><option value="message">Take message</option><option value="urgent_alert">Safety script + urgent alert</option>
              </select>
              <FSwitch label={r.when} on={r.enabled} onChange={(b) => s.setDraft({ escalation: s.draft.escalation.map((x) => x.id === r.id ? { ...x, enabled: b } : x) })} />
            </li>
          ))}</ul>
          <p className="border-t border-flw-line/60 px-4 py-3 text-xs text-flw-mute">The 999 / NHS 111 safety script can&apos;t be disabled.</p>
        </Glass>
      )}

      {tab === "Privacy" && (
        <Glass>
          <GHead title="Recording & retention" />
          <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-3">
            <div className="flex items-center justify-between rounded-xl border border-flw-line p-3 text-sm">Play recording notice<FSwitch label="Recording notice" on={p.recordingDisclosure} onChange={(b) => s.setPersona({ recordingDisclosure: b })} /></div>
            <label className="block text-xs text-flw-mute md:col-span-2">Recording notice text<input className={finput + " mt-1"} value={p.recordingText} onChange={(e) => s.setPersona({ recordingText: e.target.value })} /></label>
            <label className="block text-xs text-flw-mute">Retention (days)<input type="number" min={7} max={365} className={finput + " mt-1"} value={s.draft.retentionDays} onChange={(e) => s.setDraft({ retentionDays: Number(e.target.value) })} /></label>
          </div>
        </Glass>
      )}

      {tab === "Versions" && (
        <Glass>
          <GHead title="Published versions" />
          <ol>{[...s.published].reverse().map((v, i) => (
            <li key={v.version} className="flex flex-wrap items-center gap-3 border-t border-flw-line/60 px-4 py-3 first:border-0">
              <GitCommit size={14} className={i === 0 ? "text-flw-lime" : "text-flw-mute"} /><span className="font-mono text-sm text-flw-violet">v{v.version}</span><span className="text-sm">{v.note}</span><span className="font-mono text-[11px] text-flw-mute">{v.publishedAt}</span>
              {i === 0 ? <Chip tone="lime">live</Chip> : <FBtn className="ml-auto" onClick={() => s.rollback(v.version)}><RotateCcw size={13} /> Roll back</FBtn>}
            </li>
          ))}</ol>
        </Glass>
      )}
    </>
  );
}
