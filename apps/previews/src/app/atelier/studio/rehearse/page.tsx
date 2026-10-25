"use client";

import { clsx } from "clsx";
import { motion } from "framer-motion";
import { Mic, PhoneCall, PhoneOff, Volume2, VolumeX } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FlowCanvas } from "@/components/flow/canvas";
import { Button, Card, DemoNote, Eyebrow, H2, Pill, Switch, Title } from "@/components/atelier/ui";
import { serviceById } from "@/lib/demo-data";
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
  // Path through the conversation map, lit up as the rehearsal moves (from Design C).
  const [visited, setVisited] = useState<string[]>([]);
  useEffect(() => {
    if (!sim.messages.length) { setVisited([]); return; }
    setVisited((v) => {
      const base = v.length ? [...v] : ["persona", "greet"];
      if (sim.state.node !== "greet" && !base.includes("intent")) base.push("intent");
      return base.includes(sim.state.node) ? base : [...base, sim.state.node];
    });
  }, [sim.state.node, sim.messages.length]);
  const trace = useMemo(() => sim.messages.filter((m) => m.event.kind === "tool" || m.event.kind === "guardrail" || m.event.kind === "citation"), [sim.messages]);
  const STAGE: Record<string, string> = { open: "Listening", need_service: "Asking which service", need_time: "Asking for a time", offered: "Offering times", need_name: "Taking a name", confirming: "Waiting for a yes", booked: "Booked", transferred: "Handed to the team", ended: "Finished" };

  return (
    <div className="space-y-12">
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

    <section className="grid grid-cols-1 gap-8 xl:grid-cols-[1.2fr_1fr]">
      <div>
        <H2>The path this conversation is taking</H2>
        <p className="mt-1 text-sm text-atl-soft">Each step lights up as {agent} reaches it. The highlighted step is where it is now.</p>
        <div className="mt-5"><FlowCanvas look="ivory" active={live ? sim.state.node : undefined} visited={visited} height={620} /></div>
      </div>
      <div className="space-y-6">
        <Card className="p-6">
          <div className="font-serif text-xl">Where things stand</div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            {[["Stage", STAGE[sim.state.stage] ?? sim.state.stage], ["Service", sim.state.serviceId ? serviceById(sim.state.serviceId).name : "—"], ["Times offered", String(sim.state.offered.length)], ["Caller", sim.state.customerName ?? "—"], ["Bookings made", String(sim.state.bookings.length)], ["Frustration", ["calm", "a little", "high"][Math.min(2, sim.state.frustration)]], ["Current step", sim.state.node]].map(([k, v]) => (
              <div key={k}><dt className="text-xs uppercase tracking-[0.16em] text-atl-soft">{k}</dt><dd className="mt-0.5">{v}</dd></div>
            ))}
          </dl>
        </Card>
        <Card className="p-6">
          <div className="flex items-center justify-between"><div className="font-serif text-xl">What {agent} did</div><Pill>{trace.length} actions</Pill></div>
          <ol className="mt-4 max-h-72 space-y-3 overflow-y-auto">
            {trace.length ? trace.map((m) => {
              const e = m.event;
              if (e.kind === "tool") return (
                <li key={m.id} className={clsx("rounded-2xl p-3 ring-1", e.ok ? "bg-atl-bg/60 ring-atl-line" : "bg-atl-rose/5 ring-atl-rose/40")}>
                  <div className="flex items-center justify-between text-sm"><span className={e.ok ? "font-medium" : "font-medium text-atl-rose"}>{e.name.replaceAll("_", " ")}</span><span className="text-xs text-atl-soft">{e.latencyMs} ms</span></div>
                  <div className="mt-1 text-xs text-atl-soft">{Object.entries(e.args).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${String(v)}`).join(" · ")}</div>
                  <div className="mt-1 text-sm">{e.result}</div>
                </li>
              );
              if (e.kind === "guardrail") return <li key={m.id} className="rounded-2xl bg-atl-champ/10 p-3 text-sm text-atl-champdeep"><span className="font-medium">House rule — {e.rule.replaceAll("_", " ")}</span><div className="text-xs">{e.text}</div></li>;
              if (e.kind === "citation") return <li key={m.id} className="text-xs text-atl-soft">Quoted from your Notebook: “{e.title}” (edition {e.version})</li>;
              return null;
            }) : <li className="text-sm text-atl-soft">Actions and house rules will appear here as you talk.</li>}
          </ol>
        </Card>
        <Card className="p-6">
          <div className="font-serif text-xl">Pace of each reply</div>
          <table className="mt-3 w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-[0.16em] text-atl-soft"><th className="pb-2 font-normal">Turn</th><th className="pb-2 text-right font-normal">Speaking</th><th className="pb-2 text-right font-normal">Checking</th></tr></thead>
            <tbody>{sim.timings.slice(-6).map((t) => <tr key={t.turn} className="border-t border-atl-line"><td className="py-1.5">{t.turn}</td><td className="text-right">{t.agentMs} ms</td><td className="text-right">{t.toolMs} ms</td></tr>)}</tbody>
          </table>
          <p className="mt-2 text-xs italic text-atl-soft">Animation timings for the rehearsal, not measurements. Real response times are measured from Phase 3.</p>
        </Card>
      </div>
    </section>
    </div>
  );
}
