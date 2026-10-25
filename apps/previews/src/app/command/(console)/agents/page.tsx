"use client";

import { clsx } from "clsx";
import { GitCommit, Plus, RotateCcw, Upload } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Btn, Field, inputCls, PageHead, Panel, Slider, Tag, Toggle } from "@/components/command/ui";
import { SERVICES } from "@/lib/demo-data";
import { LANGUAGES, VOICES } from "@/lib/simulator";
import { usePreview } from "@/lib/store";

const TABS = ["Persona & voice", "Behaviour", "Escalation", "Versions"] as const;

export default function Agents() {
  const s = usePreview();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Persona & voice");
  const [note, setNote] = useState("");
  const p = s.draft.persona;
  const live = s.published.at(-1)!;
  const dirty = JSON.stringify(live.config) !== JSON.stringify(s.draft);

  return (
    <>
      <PageHead kicker="Build · agent" title={`${p.agentName} — AI receptionist`}>
        <Link href="/command/agents/new"><Btn><Plus size={14} /> New agent wizard</Btn></Link>
        <Link href="/command/simulator"><Btn>Test in simulator</Btn></Link>
      </PageHead>
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-cmd-line bg-cmd-panel px-4 py-3 text-sm">
        <Tag tone="ok">live v{live.version}</Tag>
        <span className="text-cmd-mute">published {live.publishedAt} · {live.note}</span>
        {dirty ? <Tag tone="warn">unpublished draft changes</Tag> : <Tag>draft = live</Tag>}
        <div className="ml-auto flex w-full gap-2 sm:w-auto">
          <input className={inputCls + " sm:w-64"} placeholder="Change note (required to publish)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Change note" />
          <Btn variant="primary" disabled={!dirty || !note.trim()} onClick={() => { s.publish(note); setNote(""); }}><Upload size={14} /> Publish</Btn>
        </div>
      </div>
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-cmd-line no-scrollbar" role="tablist">
        {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={clsx("whitespace-nowrap border-b-2 px-3 py-2 text-sm", tab === t ? "border-cmd-violet text-cmd-text" : "border-transparent text-cmd-mute hover:text-cmd-text")}>{t}</button>)}
      </div>

      {tab === "Persona & voice" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel title="Identity">
            <div className="space-y-4">
              <Field label="Agent name"><input className={inputCls} value={p.agentName} onChange={(e) => s.setPersona({ agentName: e.target.value })} /></Field>
              <Field label="Greeting" hint="{business} and {agent} are replaced at runtime. Must disclose that the caller is speaking to an AI.">
                <textarea rows={3} className={inputCls} value={p.greeting} onChange={(e) => s.setPersona({ greeting: e.target.value })} />
              </Field>
              {!/\bAI\b/i.test(p.greeting) && <p className="text-xs text-cmd-bad">Warning: greeting no longer discloses AI identity. Publishing will be blocked in production.</p>}
              <Field label="Language"><select className={inputCls} value={s.draft.language} onChange={(e) => s.setDraft({ language: e.target.value })}>{LANGUAGES.map((l) => <option key={l} disabled={l.includes("planned")}>{l}</option>)}</select></Field>
            </div>
          </Panel>
          <Panel title="Voice">
            <div className="space-y-2">
              {VOICES.map((v) => (
                <label key={v.id} className={clsx("flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2", s.draft.voiceId === v.id ? "border-cmd-violet bg-cmd-violet/10" : "border-cmd-line hover:border-cmd-violet/40")}>
                  <input type="radio" name="voice" className="accent-[rgb(var(--cmd-violet))]" checked={s.draft.voiceId === v.id} onChange={() => s.setDraft({ voiceId: v.id })} />
                  <span className="flex-1 text-sm">{v.label}</span><span className="font-mono text-[10px] text-cmd-mute">{v.accent} · {v.pace}</span>
                  <button type="button" className="rounded border border-cmd-line px-2 py-0.5 text-[11px] text-cmd-mute hover:text-cmd-text" onClick={(e) => { e.preventDefault(); if ("speechSynthesis" in window) { const u = new SpeechSynthesisUtterance(p.greeting.replace("{business}", p.businessName).replace("{agent}", p.agentName)); u.lang = v.accent; u.rate = s.draft.speakingRate; speechSynthesis.cancel(); speechSynthesis.speak(u); } }}>Preview</button>
                </label>
              ))}
              <p className="text-xs text-cmd-mute">Preview uses your browser&apos;s built-in speech synthesis as a stand-in. Production voices come from the selected TTS provider.</p>
              <Field label={`Speaking rate · ${s.draft.speakingRate.toFixed(2)}×`}><Slider label="Speaking rate" min={0.8} max={1.2} step={0.05} value={s.draft.speakingRate} onChange={(n) => s.setDraft({ speakingRate: n })} /></Field>
            </div>
          </Panel>
          <Panel title="Personality" className="lg:col-span-2">
            <div className="grid gap-6 sm:grid-cols-2">
              <Field label={`Warmth · ${p.warmth}`} hint="Higher adds softer phrasing; never adds facts."><Slider label="Warmth" value={p.warmth} onChange={(n) => s.setPersona({ warmth: n })} /></Field>
              <Field label={`Detail · ${p.verbosity}`} hint="Lower keeps answers to two sentences."><Slider label="Detail" value={p.verbosity} onChange={(n) => s.setPersona({ verbosity: n })} /></Field>
            </div>
          </Panel>
        </div>
      )}

      {tab === "Behaviour" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel title="Tool permissions">
            {[["Book, move & cancel appointments", "allowBooking"], ["Transfer calls to staff", "allowTransfer"]].map(([label, key]) => (
              <div key={key} className="flex items-center justify-between border-b border-cmd-line py-2.5 last:border-0">
                <span className="text-sm">{label}</span>
                <Toggle label={label} on={p[key as "allowBooking" | "allowTransfer"]} onChange={(b) => s.setPersona({ [key]: b })} />
              </div>
            ))}
            <p className="mt-2 text-xs text-cmd-mute">Knowledge lookup and message-taking are always available. CRM write-back is configured under Integrations.</p>
          </Panel>
          <Panel title="After hours">
            <div className="space-y-2">
              {([["answer_and_book", "Answer and book future slots"], ["take_message", "Answer, take a message only"], ["voicemail", "Send to voicemail"]] as const).map(([k, l]) => (
                <label key={k} className="flex items-center gap-3 text-sm"><input type="radio" className="accent-[rgb(var(--cmd-violet))]" checked={s.draft.afterHours === k} onChange={() => s.setDraft({ afterHours: k })} />{l}</label>
              ))}
            </div>
          </Panel>
          <Panel title="Bookable services" className="lg:col-span-2">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {SERVICES.map((svc) => {
                const on = s.draft.enabledServiceIds.includes(svc.id);
                return (
                  <label key={svc.id} className={clsx("flex items-center gap-3 rounded-md border px-3 py-2 text-sm", !svc.bookableByAgent ? "border-cmd-line opacity-50" : on ? "border-cmd-violet/60" : "border-cmd-line")}>
                    <input type="checkbox" disabled={!svc.bookableByAgent} className="accent-[rgb(var(--cmd-violet))]" checked={on && svc.bookableByAgent} onChange={() => s.setDraft({ enabledServiceIds: on ? s.draft.enabledServiceIds.filter((x) => x !== svc.id) : [...s.draft.enabledServiceIds, svc.id] })} />
                    <span className="flex-1">{svc.name}</span><span className="font-mono text-[11px] text-cmd-mute">{svc.durationMin}m · £{svc.priceFromGBP}</span>
                  </label>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-cmd-mute">Greyed services must be arranged by staff — the agent takes a message.</p>
          </Panel>
          <Panel title="Recording & retention" className="lg:col-span-2">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex items-center justify-between"><span className="text-sm">Play recording notice</span><Toggle label="Recording notice" on={p.recordingDisclosure} onChange={(b) => s.setPersona({ recordingDisclosure: b })} /></div>
              <Field label="Retention (days)"><input type="number" min={7} max={365} className={inputCls} value={s.draft.retentionDays} onChange={(e) => s.setDraft({ retentionDays: Number(e.target.value) })} /></Field>
              <Field label="Recording notice text"><input className={inputCls} value={p.recordingText} onChange={(e) => s.setPersona({ recordingText: e.target.value })} /></Field>
            </div>
          </Panel>
        </div>
      )}

      {tab === "Escalation" && (
        <Panel title="Escalation rules" dense>
          <table className="w-full text-sm">
            <tbody>
              {s.draft.escalation.map((r) => (
                <tr key={r.id} className="border-t border-cmd-line first:border-0">
                  <td className="px-4 py-3">{r.when}</td>
                  <td className="px-2"><select className={inputCls + " w-auto"} value={r.action} onChange={(e) => s.setDraft({ escalation: s.draft.escalation.map((x) => x.id === r.id ? { ...x, action: e.target.value as typeof r.action } : x) })}><option value="transfer">Warm transfer</option><option value="message">Take message</option><option value="urgent_alert">Urgent alert + safety script</option></select></td>
                  <td className="px-4 text-right"><Toggle label={r.when} on={r.enabled} onChange={(b) => s.setDraft({ escalation: s.draft.escalation.map((x) => x.id === r.id ? { ...x, enabled: b } : x) })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-cmd-line px-4 py-3 text-xs text-cmd-mute">Transfer destination: <span className="text-cmd-text">{p.transferTarget}</span> · the safety script (999 / NHS 111 guidance) cannot be disabled.</div>
        </Panel>
      )}

      {tab === "Versions" && (
        <Panel title="Published versions" dense>
          <ol>
            {[...s.published].reverse().map((v, i) => (
              <li key={v.version} className="flex flex-wrap items-center gap-3 border-t border-cmd-line px-4 py-3 first:border-0">
                <GitCommit size={14} className={i === 0 ? "text-cmd-ok" : "text-cmd-mute"} />
                <span className="font-mono text-sm">v{v.version}</span>
                <span className="text-sm">{v.note}</span>
                <span className="font-mono text-[11px] text-cmd-mute">{v.publishedAt}</span>
                {i === 0 ? <Tag tone="ok">live</Tag> : <Btn className="ml-auto" onClick={() => s.rollback(v.version)}><RotateCcw size={13} /> Roll back</Btn>}
              </li>
            ))}
          </ol>
        </Panel>
      )}
    </>
  );
}
