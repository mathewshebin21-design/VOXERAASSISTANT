"use client";

import { clsx } from "clsx";
import { Play } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, Card, DemoNote, Eyebrow, field, H2, Label, Pill, Range, Switch, Title } from "@/components/atelier/ui";
import { APPOINTMENTS } from "@/lib/demo-data";
import { initialState, respond, VOICES } from "@/lib/simulator";
import { usePreview } from "@/lib/store";

const SAMPLES = ["How much is balayage?", "Where can I park?", "What's your cancellation policy?"];

export default function Voice() {
  const s = usePreview();
  const p = s.draft.persona;
  const [sample, setSample] = useState(SAMPLES[0]);
  const [note, setNote] = useState("");
  const live = s.published.at(-1)!;
  const dirty = JSON.stringify(live.config) !== JSON.stringify(s.draft);
  const reply = useMemo(() => {
    const r = respond(sample, initialState(), { persona: p, knowledge: s.knowledge, appointments: APPOINTMENTS });
    return r.events.filter((e) => e.kind === "agent").map((e) => (e as { text: string }).text).join(" ");
  }, [sample, p, s.knowledge]);
  const speak = (text: string, lang = "en-GB") => {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang; u.rate = s.draft.speakingRate;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  };

  return (
    <div className="space-y-12">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
        <div><Eyebrow>Voice & manner</Eyebrow><Title className="mt-4">How {p.agentName} carries a conversation.</Title></div>
        <Card className="flex flex-wrap items-center gap-3 p-4">
          <Pill tone="sage">Edition {live.version} is live</Pill>
          {dirty ? <Pill tone="champ">Unpublished changes</Pill> : <Pill>No changes</Pill>}
        </Card>
      </div>

      <section className="grid grid-cols-1 gap-8 lg:grid-cols-[1.1fr_1fr]">
        <Card className="space-y-8 p-8">
          <div><Label htmlFor="nm">Name</Label><input id="nm" className={field} value={p.agentName} onChange={(e) => s.setPersona({ agentName: e.target.value })} /></div>
          <div><Label htmlFor="gr" hint="Use {business} and {agent}. It must say this is an AI receptionist.">Greeting</Label><textarea id="gr" rows={3} className={field} value={p.greeting} onChange={(e) => s.setPersona({ greeting: e.target.value })} />
            {!/\bAI\b/i.test(p.greeting) && <p className="mt-2 text-sm text-atl-rose">Your greeting no longer mentions that {p.agentName} is an AI. Callers must be told.</p>}</div>
          <div className="grid gap-8 sm:grid-cols-2">
            <div><Label>Manner</Label><Range label="Warmth" value={p.warmth} onChange={(n) => s.setPersona({ warmth: n })} left="Crisp" right="Warm" /></div>
            <div><Label>Detail</Label><Range label="Detail" value={p.verbosity} onChange={(n) => s.setPersona({ verbosity: n })} left="Brief" right="Thorough" /></div>
            <div><Label>Pace</Label><Range label="Speaking rate" min={0.8} max={1.2} step={0.05} value={s.draft.speakingRate} onChange={(n) => s.setDraft({ speakingRate: n })} left="Unhurried" right="Brisk" /></div>
          </div>
        </Card>
        <div className="space-y-6">
          <Card className="p-8">
            <Eyebrow>Hear the difference</Eyebrow>
            <div className="mt-4 flex flex-wrap gap-2">{SAMPLES.map((x) => <button key={x} onClick={() => setSample(x)} className={clsx("rounded-full px-3 py-1.5 text-xs ring-1", sample === x ? "bg-atl-ink text-atl-paper ring-atl-ink" : "ring-atl-line")}>{x}</button>)}</div>
            <p className="mt-6 text-sm text-atl-soft">A caller asks: “{sample}”</p>
            <p className="mt-2 font-serif text-2xl leading-snug">“{reply}”</p>
            <Button variant="outline" className="mt-6" onClick={() => speak(reply)}><Play size={14} /> Play with browser voice</Button>
            <div className="mt-4"><DemoNote>Answers come from your Notebook. The browser voice is a stand-in for the real voice provider.</DemoNote></div>
          </Card>
          <Card className="p-6">
            <Label>Voice</Label>
            <div className="mt-2 divide-y divide-atl-line">
              {VOICES.map((v) => (
                <div key={v.id} className="flex items-center gap-3 py-3">
                  <input type="radio" name="v" aria-label={v.label} className="accent-[rgb(var(--atl-champdeep))]" checked={s.draft.voiceId === v.id} onChange={() => s.setDraft({ voiceId: v.id })} />
                  <div className="flex-1"><div className="font-serif text-lg">{v.label.split(" · ")[0]}</div><div className="text-xs text-atl-soft">{v.label.split(" · ")[1]}</div></div>
                  <button className="text-atl-soft hover:text-atl-ink" aria-label={`Preview ${v.label}`} onClick={() => speak(p.greeting.replace("{business}", p.businessName).replace("{agent}", p.agentName), v.accent)}><Play size={16} /></button>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </section>

      <section>
        <H2>House rules</H2>
        <p className="mt-2 text-atl-soft">Plain-language rules for when {p.agentName} steps aside.</p>
        <Card className="mt-6 divide-y divide-atl-line">
          {s.draft.escalation.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-4 p-5">
              <div className="min-w-0 flex-1"><span className="text-atl-soft">When </span>{r.when.toLowerCase()}<span className="text-atl-soft">, {p.agentName} will </span>
                <select aria-label={`Action for ${r.when}`} className="rounded-full border border-atl-line bg-atl-bg px-3 py-1 text-sm" value={r.action} onChange={(e) => s.setDraft({ escalation: s.draft.escalation.map((x) => x.id === r.id ? { ...x, action: e.target.value as typeof r.action } : x) })}>
                  <option value="transfer">pass the call to the team</option><option value="message">take a message</option><option value="urgent_alert">give safety guidance and alert you</option>
                </select>.
              </div>
              <Switch label={r.when} on={r.enabled} onChange={(b) => s.setDraft({ escalation: s.draft.escalation.map((x) => x.id === r.id ? { ...x, enabled: b } : x) })} />
            </div>
          ))}
          <div className="flex items-center justify-between gap-4 p-5"><div>Mention call recording at the start</div><Switch label="Recording notice" on={p.recordingDisclosure} onChange={(b) => s.setPersona({ recordingDisclosure: b })} /></div>
          <div className="flex items-center justify-between gap-4 p-5"><div>Book, move and cancel appointments</div><Switch label="Allow booking" on={p.allowBooking} onChange={(b) => s.setPersona({ allowBooking: b })} /></div>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_1fr]">
        <div>
          <H2>Publish an edition</H2>
          <p className="mt-2 text-atl-soft">Rehearse first. Every edition is kept, so you can always return to one.</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <input aria-label="What changed" className={field} placeholder="What changed? e.g. Softer greeting" value={note} onChange={(e) => setNote(e.target.value)} />
            <Button disabled={!dirty || !note.trim()} onClick={() => { s.publish(note); setNote(""); }}>Publish</Button>
          </div>
        </div>
        <ol className="space-y-3">
          {[...s.published].reverse().map((v, i) => (
            <li key={v.version} className="flex items-center gap-4 rounded-2xl border border-atl-line bg-atl-paper px-5 py-3">
              <span className="font-serif text-2xl italic text-atl-champ">{v.version}</span>
              <div className="min-w-0 flex-1"><div className="truncate">{v.note}</div><div className="text-xs text-atl-soft">{v.publishedAt}</div></div>
              {i === 0 ? <Pill tone="sage">live</Pill> : <Button variant="quiet" onClick={() => s.rollback(v.version)}>Return to this</Button>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
