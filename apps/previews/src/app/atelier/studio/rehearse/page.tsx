"use client";

import { clsx } from "clsx";
import { motion } from "framer-motion";
import { Mic, PhoneCall, PhoneOff, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Card, DemoNote, Eyebrow, Switch, Title } from "@/components/atelier/ui";
import { usePreview } from "@/lib/store";
import { useSimulator } from "@/lib/use-simulator";

const NOTE: Record<string, string> = {
  check_availability: "checked the diary", create_booking: "made the booking", search_knowledge: "looked in your Notebook", get_opening_hours: "checked your hours",
  transfer_call: "passed the call to your team", take_message: "took a message", escalate: "alerted you", find_booking: "looked for a booking",
};

export default function Rehearse() {
  const sim = useSimulator();
  const agent = usePreview((s) => s.draft.persona.agentName);
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [sim.messages]);
  const live = sim.messages.length > 0;

  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_420px]">
      <div>
        <Eyebrow>Rehearsal room</Eyebrow>
        <Title className="mt-4">Play the caller. See how {agent} responds.</Title>
        <p className="mt-5 max-w-xl text-lg text-atl-soft">Nothing here reaches a real client or calendar. Try something ordinary, then something awkward.</p>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {sim.scenarios.map((s) => (
            <button key={s.id} onClick={() => sim.runScenario(s.id)} className="rounded-2xl border border-atl-line bg-atl-paper px-5 py-4 text-left transition hover:border-atl-champ">
              <div className="font-serif text-lg">{s.label}</div>
              <div className="mt-1 line-clamp-1 text-xs text-atl-soft">“{s.lines[0]}”</div>
            </button>
          ))}
        </div>
        <Card className="mt-8 flex flex-wrap items-center justify-between gap-4 p-5">
          <div><div className="font-medium">Rehearse a bad day</div><div className="text-sm text-atl-soft">Pretend the diary or knowledge service isn&apos;t responding.</div></div>
          <Switch label="Simulate provider failures" on={sim.failTools} onChange={sim.setFailTools} />
        </Card>
        <div className="mt-6"><DemoNote>This rehearsal uses a rule-based stand-in for the language model, so phrasing is simpler than the live receptionist will be. The behaviour — what it checks, what it refuses, when it hands over — is what we&apos;re testing.</DemoNote></div>
      </div>

      <div className="mx-auto w-full max-w-[420px]">
        <div className="rounded-[44px] border border-atl-line bg-atl-ink p-3 shadow-2xl">
          <div className="flex h-[640px] flex-col overflow-hidden rounded-[34px] bg-atl-paper">
            <div className="flex flex-col items-center gap-2 border-b border-atl-line px-6 pb-5 pt-7">
              <motion.div animate={{ scale: sim.speaking ? [1, 1.08, 1] : 1 }} transition={{ repeat: sim.speaking ? Infinity : 0, duration: 1.2 }} className="grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-atl-champ to-atl-champdeep font-serif text-2xl text-atl-paper">{agent[0]}</motion.div>
              <div className="font-serif text-xl">{agent}</div>
              <div className="text-xs text-atl-soft">{!live ? "Ready to rehearse" : sim.speaking ? "speaking…" : sim.thinking ? "thinking…" : sim.listening ? "listening…" : "your turn"}</div>
              <div className="flex h-5 items-end gap-[3px]" aria-hidden>
                {Array.from({ length: 18 }, (_, i) => <motion.span key={i} className="w-[3px] rounded-full bg-atl-champdeep/70" animate={{ height: sim.speaking ? [4, 6 + ((i * 7) % 14), 4] : 3 }} transition={{ repeat: sim.speaking ? Infinity : 0, duration: 0.5 + (i % 4) * 0.12 }} />)}
              </div>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4" aria-live="polite">
              {!live && <div className="grid h-full place-items-center"><Button onClick={sim.start}><PhoneCall size={16} /> Ring the studio</Button></div>}
              {sim.messages.map((m) => {
                const e = m.event;
                if (e.kind === "caller") return <div key={m.id} className="ml-auto max-w-[80%] rounded-3xl rounded-br-md bg-atl-ink px-4 py-2.5 text-[15px] text-atl-paper">{e.text}</div>;
                if (e.kind === "agent") return <div key={m.id} className={clsx("max-w-[86%] rounded-3xl rounded-bl-md bg-atl-bg px-4 py-2.5 text-[15px] ring-1 ring-atl-line", m.interrupted && "opacity-70")}>{e.text.slice(0, m.shown ?? e.text.length)}{m.interrupted && <span className="ml-1 text-xs italic text-atl-soft">— interrupted</span>}</div>;
                if (e.kind === "tool") return <div key={m.id} className={clsx("text-center text-[11px] italic", e.ok ? "text-atl-champdeep" : "text-atl-rose")}>{agent} {NOTE[e.name] ?? e.name}{e.ok ? "" : " — but it didn't respond"}</div>;
                if (e.kind === "guardrail") return <div key={m.id} className="mx-auto max-w-[90%] rounded-2xl bg-atl-champ/10 px-3 py-2 text-center text-[11px] text-atl-champdeep">House rule applied ({e.rule.replaceAll("_", " ")}): {e.text}</div>;
                if (e.kind === "citation") return <div key={m.id} className="text-[10px] text-atl-soft">from your Notebook: “{e.title}”</div>;
                return <div key={m.id} className="text-center text-[10px] uppercase tracking-[0.2em] text-atl-soft">{e.label}</div>;
              })}
              <div ref={end} />
            </div>
            <form onSubmit={(e) => { e.preventDefault(); sim.submit(text); setText(""); }} className="flex items-center gap-2 border-t border-atl-line p-3">
              <button type="button" onClick={sim.listening ? sim.stopListening : sim.listen} disabled={!sim.sttSupported} className={clsx("grid h-10 w-10 shrink-0 place-items-center rounded-full ring-1 ring-atl-line", sim.listening && "bg-atl-rose text-atl-paper", !sim.sttSupported && "opacity-30")} aria-label="Speak (browser speech recognition)"><Mic size={16} /></button>
              <input aria-label="Caller message" value={sim.interim || text} onChange={(e) => setText(e.target.value)} placeholder="Say something as the caller…" className="min-w-0 flex-1 rounded-full bg-atl-bg px-4 py-2.5 text-sm outline-none ring-1 ring-atl-line focus:ring-atl-champ" />
              <button type="button" onClick={() => sim.setTts(!sim.tts)} disabled={!sim.ttsSupported} className="grid h-10 w-10 place-items-center rounded-full text-atl-soft disabled:opacity-30" aria-label={sim.tts ? "Mute voice" : "Hear replies"}>{sim.tts ? <Volume2 size={16} /> : <VolumeX size={16} />}</button>
              {live && <button type="button" onClick={sim.start} className="grid h-10 w-10 place-items-center rounded-full bg-atl-rose text-atl-paper" aria-label="Hang up and restart"><PhoneOff size={16} /></button>}
            </form>
          </div>
        </div>
        <p className="mt-3 text-center text-xs text-atl-soft">Simulated call · interrupt at any time by typing</p>
      </div>
    </div>
  );
}
