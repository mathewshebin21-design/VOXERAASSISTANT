"use client";

import { Play } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { FlowCanvas } from "@/components/flow/canvas";
import { Button, Card, DemoNote, Eyebrow, field, Label, Pill, Range, Switch, Title } from "@/components/atelier/ui";
import { FLOW_NODES, TOOL_SCHEMAS } from "@/lib/flow-graph";
import { LANGUAGES, VOICES } from "@/lib/simulator";
import { usePreview } from "@/lib/store";

const BOOKING = ["book", "slots", "details", "confirm", "booked"];
const PLAIN: Record<string, string> = {
  persona: "Who your receptionist is and how it sounds.", greet: "Says it's an AI receptionist and mentions recording.", guard: "Ignores callers who try to rewrite its instructions.",
  intent: "Works out what the caller wants.", book: "Asks which service, offering only those it may book.", slots: "Checks the diary for genuinely free times.",
  details: "Takes the caller's name.", confirm: "Reads everything back and waits for a clear yes.", booked: "Writes the booking — once, never twice.",
  kb: "Answers only from confirmed Notebook pages.", fallback: "Says when it doesn't know, rather than guessing.", escalate: "Gives 999 / NHS 111 guidance and alerts you.",
  transfer: "Passes the caller to your team with a summary.", message: "Takes a message when no one can come to the phone.", end: "Wraps up and files the summary in your Journal.",
};

export default function ConversationMap() {
  const s = usePreview();
  const p = s.draft.persona;
  const [sel, setSel] = useState("persona");
  const [note, setNote] = useState("");
  const node = FLOW_NODES.find((n) => n.id === sel)!;
  const disabled = [...(p.allowBooking ? [] : BOOKING), ...(p.allowTransfer ? [] : ["transfer"])];
  const live = s.published.at(-1)!;
  const dirty = JSON.stringify(live.config) !== JSON.stringify(s.draft);

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div><Eyebrow>Conversation map</Eyebrow><Title className="mt-4">How {p.agentName} thinks, step by step.</Title></div>
        <div className="flex flex-wrap gap-2"><Pill tone="sage">Edition {live.version} live</Pill>{dirty && <Pill tone="champ">Unpublished changes</Pill>}</div>
      </div>
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[1fr_400px]">
        <div>
          <FlowCanvas look="ivory" selected={sel} onSelect={setSel} disabled={disabled} height={720} />
          <div className="mt-3"><DemoNote>Select any step to see or change how it behaves. The map mirrors the rehearsal logic; rearranging steps is planned for a later phase.</DemoNote></div>
        </div>
        <div className="space-y-6">
          <Card className="p-7">
            <div className="flex items-center justify-between gap-2"><div className="font-serif text-2xl">{node.label}</div><Pill>{node.kind}</Pill></div>
            <p className="mt-2 text-atl-soft">{PLAIN[node.id]}</p>
            <div className="mt-6 space-y-5">
              {node.id === "persona" && <>
                <div><Label htmlFor="mn">Name</Label><input id="mn" className={field} value={p.agentName} onChange={(e) => s.setPersona({ agentName: e.target.value })} /></div>
                <div><Label htmlFor="mg" hint="Must say it's an AI receptionist.">Greeting</Label><textarea id="mg" rows={3} className={field} value={p.greeting} onChange={(e) => s.setPersona({ greeting: e.target.value })} />
                  {!/\bAI\b/i.test(p.greeting) && <p className="mt-2 text-sm text-atl-rose">Callers must be told they&apos;re speaking to an AI.</p>}</div>
                <div><Label htmlFor="mv">Voice</Label><select id="mv" className={field} value={s.draft.voiceId} onChange={(e) => s.setDraft({ voiceId: e.target.value })}>{VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select></div>
                <div><Label htmlFor="ml">Language</Label><select id="ml" className={field} value={s.draft.language} onChange={(e) => s.setDraft({ language: e.target.value })}>{LANGUAGES.map((l) => <option key={l} disabled={l.includes("planned")}>{l}</option>)}</select></div>
                <div><Label>Manner</Label><Range label="Warmth" value={p.warmth} onChange={(n) => s.setPersona({ warmth: n })} left="Crisp" right="Warm" /></div>
                <div><Label>Detail</Label><Range label="Detail" value={p.verbosity} onChange={(n) => s.setPersona({ verbosity: n })} left="Brief" right="Thorough" /></div>
                <div><Label>Pace</Label><Range label="Speaking rate" min={0.8} max={1.2} step={0.05} value={s.draft.speakingRate} onChange={(n) => s.setDraft({ speakingRate: n })} left="Unhurried" right="Brisk" /></div>
              </>}
              {node.id === "greet" && <div className="flex items-center justify-between gap-4">Mention call recording<Switch label="Recording notice" on={p.recordingDisclosure} onChange={(b) => s.setPersona({ recordingDisclosure: b })} /></div>}
              {BOOKING.includes(node.id) && <div className="flex items-center justify-between gap-4">Book, move and cancel appointments<Switch label="Booking tools" on={p.allowBooking} onChange={(b) => s.setPersona({ allowBooking: b })} /></div>}
              {node.id === "transfer" && <>
                <div className="flex items-center justify-between gap-4">Pass calls to the team<Switch label="Transfers" on={p.allowTransfer} onChange={(b) => s.setPersona({ allowTransfer: b })} /></div>
                <div><Label htmlFor="mt">Who takes the call</Label><input id="mt" className={field} value={p.transferTarget} onChange={(e) => s.setPersona({ transferTarget: e.target.value })} /></div>
              </>}
              {node.id === "confirm" && <p className="rounded-2xl bg-atl-champ/10 px-4 py-3 text-sm text-atl-champdeep">House rule: nothing is booked until the caller clearly says yes to the read-back.</p>}
              {["guard", "escalate", "fallback"].includes(node.id) && <p className="rounded-2xl bg-atl-champ/10 px-4 py-3 text-sm text-atl-champdeep">A safety step — always on. You can rehearse it, but not switch it off.</p>}
              {node.tool && TOOL_SCHEMAS[node.tool] && (
                <div>
                  <Label hint="What this action needs before it may run. Checked before every use.">The action&apos;s details</Label>
                  <dl className="divide-y divide-atl-line rounded-2xl bg-atl-bg/70 px-4 text-sm ring-1 ring-atl-line">
                    {Object.entries(TOOL_SCHEMAS[node.tool]).map(([k, v]) => <div key={k} className="flex justify-between gap-4 py-2"><dt className="font-mono text-xs">{k}</dt><dd className="text-right text-xs text-atl-soft">{String(v)}</dd></div>)}
                  </dl>
                </div>
              )}
              <Link href="/atelier/studio/rehearse" className="block"><Button variant="outline" className="w-full"><Play size={14} /> Rehearse this</Button></Link>
            </div>
          </Card>
          <Card className="p-7">
            <div className="font-serif text-xl">Publish an edition</div>
            <div className="mt-4 flex flex-col gap-3">
              <input aria-label="What changed" className={field} placeholder="What changed?" value={note} onChange={(e) => setNote(e.target.value)} />
              <Button disabled={!dirty || !note.trim()} onClick={() => { s.publish(note); setNote(""); }}>Publish</Button>
            </div>
            <ol className="mt-5 space-y-2">
              {[...s.published].reverse().slice(0, 5).map((v, i) => (
                <li key={v.version} className="flex items-center gap-3 text-sm">
                  <span className="font-serif text-lg italic text-atl-champ">{v.version}</span><span className="flex-1 truncate">{v.note}</span>
                  {i === 0 ? <Pill tone="sage">live</Pill> : <Button variant="quiet" onClick={() => s.rollback(v.version)}>Return</Button>}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
