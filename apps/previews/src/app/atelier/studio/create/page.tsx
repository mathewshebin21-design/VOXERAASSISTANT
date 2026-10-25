"use client";

import { clsx } from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { HoursEditor } from "@/components/shared/hours";
import { Button, Card, Eyebrow, field, Label, Range, Switch } from "@/components/atelier/ui";
import { SERVICES } from "@/lib/demo-data";
import { VOICES } from "@/lib/simulator";
import { useWizard } from "@/lib/wizard";

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];
const QUESTION: Record<string, string> = {
  business: "First, tell us about your studio.",
  services: "Which services may your receptionist book?",
  hours: "When are your doors open?",
  voice: "How should your receptionist sound?",
  knowledge: "What should it know?",
  safety: "When should it hand over to you?",
  review: "Here's your receptionist.",
};

export default function Create() {
  const w = useWizard();
  const router = useRouter();
  const { d, set } = w;
  const id = w.current.id;
  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center gap-4">
        <Eyebrow>Chapter {ROMAN[w.step]} of VII · {w.current.title}</Eyebrow>
        <div className="h-px flex-1 bg-atl-line"><motion.div className="h-px bg-atl-champdeep" animate={{ width: `${((w.step + 1) / w.steps.length) * 100}%` }} /></div>
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.35 }}>
          <h1 className="mt-8 font-serif text-4xl leading-tight sm:text-5xl">{QUESTION[id]}</h1>
          <p className="mt-3 text-atl-soft">{w.current.blurb}</p>
          <div className="mt-10 space-y-6">
            {id === "business" && <>
              <div><Label htmlFor="bn">Studio name</Label><input id="bn" className={field} value={d.businessName} onChange={(e) => set({ businessName: e.target.value })} /></div>
              <div><Label htmlFor="an" hint="Callers will hear this name.">Your receptionist&apos;s name</Label><input id="an" className={field} value={d.agentName} onChange={(e) => set({ agentName: e.target.value })} /></div>
              <div><Label>What kind of business?</Label>
                <div className="flex flex-wrap gap-2">{["Hair & beauty", "Aesthetics clinic", "Wellness & spa", "Agency"].map((x) => <button key={x} type="button" onClick={() => set({ sector: x })} className={clsx("rounded-full px-4 py-2 text-sm ring-1", d.sector === x ? "bg-atl-ink text-atl-paper ring-atl-ink" : "ring-atl-line hover:ring-atl-champ")}>{x}</button>)}</div>
              </div>
            </>}
            {id === "services" && <div className="grid gap-3 sm:grid-cols-2">
              {SERVICES.map((s) => {
                const on = d.serviceIds.includes(s.id);
                return <button key={s.id} type="button" disabled={!s.bookableByAgent} onClick={() => set({ serviceIds: on ? d.serviceIds.filter((x) => x !== s.id) : [...d.serviceIds, s.id] })}
                  className={clsx("rounded-2xl border p-4 text-left transition", on ? "border-atl-ink bg-atl-paper" : "border-atl-line bg-atl-bg/50 hover:border-atl-champ", !s.bookableByAgent && "opacity-50")} aria-pressed={on}>
                  <div className="flex items-baseline justify-between"><span className="font-serif text-xl">{s.name}</span><span className="text-sm text-atl-soft">from £{s.priceFromGBP}</span></div>
                  <div className="mt-1 text-xs text-atl-soft">{s.durationMin} minutes{s.requiresPatchTest ? " · patch test needed" : ""}{!s.bookableByAgent ? " · arranged by your team" : ""}</div>
                </button>;
              })}
            </div>}
            {id === "hours" && <>
              <Card className="p-5"><HoursEditor hours={d.hours} onChange={(h) => set({ hours: h })} theme="atl" /></Card>
              <div><Label>When you&apos;re closed, your receptionist should…</Label>
                <div className="space-y-2">{([["answer_and_book", "Answer and book future appointments"], ["take_message", "Answer and take a message"], ["voicemail", "Let calls go to voicemail"]] as const).map(([k, l]) => (
                  <label key={k} className="flex items-center gap-3 rounded-2xl border border-atl-line px-4 py-3"><input type="radio" className="accent-[rgb(var(--atl-champdeep))]" checked={d.afterHours === k} onChange={() => set({ afterHours: k })} />{l}</label>
                ))}</div>
              </div>
            </>}
            {id === "voice" && <>
              <div className="grid gap-3 sm:grid-cols-2">{VOICES.map((v) => (
                <button key={v.id} type="button" onClick={() => set({ voiceId: v.id })} aria-pressed={d.voiceId === v.id} className={clsx("rounded-2xl border p-4 text-left", d.voiceId === v.id ? "border-atl-ink bg-atl-paper" : "border-atl-line hover:border-atl-champ")}>
                  <div className="font-serif text-xl">{v.label.split(" · ")[0]}</div><div className="text-xs text-atl-soft">{v.label.split(" · ")[1]} · {v.pace}</div>
                </button>
              ))}</div>
              <div><Label htmlFor="gr" hint="Callers must be told they're speaking to an AI receptionist.">Greeting</Label><textarea id="gr" rows={3} className={field} value={d.greeting} onChange={(e) => set({ greeting: e.target.value })} /></div>
              <div className="grid gap-6 sm:grid-cols-2">
                <div><Label>Manner</Label><Range label="Warmth" value={d.warmth} onChange={(n) => set({ warmth: n })} left="Crisp" right="Warm" /></div>
                <div><Label>Detail</Label><Range label="Detail" value={d.verbosity} onChange={(n) => set({ verbosity: n })} left="Brief" right="Thorough" /></div>
              </div>
            </>}
            {id === "knowledge" && <>
              <Card className="flex items-center justify-between gap-4 p-5"><div><div className="font-medium">Read my website</div><div className="text-sm text-atl-soft">{d.website} — pages wait for your approval before use.</div></div><Switch label="Import website" on={d.importWebsite} onChange={(b) => set({ importWebsite: b })} /></Card>
              <div><Label htmlFor="fq" hint="One per line. You'll write the answers in your Notebook.">Questions clients often ask</Label><textarea id="fq" rows={5} className={field} value={d.faqs} onChange={(e) => set({ faqs: e.target.value })} /></div>
            </>}
            {id === "safety" && <>
              <div><Label htmlFor="tn">Who should calls go to when a person is needed?</Label><input id="tn" className={field} value={d.transferNumber} onChange={(e) => set({ transferNumber: e.target.value })} /></div>
              <Card className="divide-y divide-atl-line">
                <div className="flex items-center justify-between gap-4 p-5"><div><div className="font-medium">Tell callers about recording</div><div className="text-sm text-atl-soft">Played before anything is captured.</div></div><Switch label="Recording notice" on={d.recordingDisclosure} onChange={(b) => set({ recordingDisclosure: b })} /></div>
                <div className="flex items-center justify-between gap-4 p-5"><div><div className="font-medium">Alert me to anything urgent</div><div className="text-sm text-atl-soft">Reactions or injuries: callers are pointed to 999 / NHS 111, and you&apos;re notified.</div></div><Switch label="Urgent alerts" on={d.urgentAlerts} onChange={(b) => set({ urgentAlerts: b })} /></div>
              </Card>
            </>}
            {id === "review" && <Card className="p-8">
              <p className="font-serif text-2xl leading-snug">“{d.greeting.replace("{business}", d.businessName).replace("{agent}", d.agentName)}”</p>
              <dl className="mt-8 grid gap-4 text-sm sm:grid-cols-2">
                {[["Studio", d.businessName], ["Receptionist", d.agentName], ["Bookable services", d.serviceIds.length], ["Voice", VOICES.find((v) => v.id === d.voiceId)?.label], ["Out of hours", d.afterHours.replaceAll("_", " ")], ["Hand-over to", d.transferNumber]].map(([k, v]) => <div key={String(k)}><dt className="text-atl-soft">{k}</dt><dd className="font-medium">{v}</dd></div>)}
              </dl>
              <p className="mt-8 text-xs italic text-atl-soft">Saving keeps this as a draft. Nothing goes live and no phone number is connected in this preview.</p>
            </Card>}
            {w.errors[id] && <p role="alert" className="text-sm text-atl-rose">{w.errors[id]}</p>}
          </div>
        </motion.div>
      </AnimatePresence>
      <div className="mt-12 flex items-center justify-between">
        <Button variant="quiet" onClick={w.back} disabled={w.step === 0}><ArrowLeft size={16} /> Back</Button>
        {w.step < w.steps.length - 1
          ? <Button onClick={w.next} disabled={!w.canNext}>Continue <ArrowRight size={16} /></Button>
          : <Button onClick={() => { w.finish(); router.push("/atelier/studio/rehearse"); }}>Save and rehearse</Button>}
      </div>
    </div>
  );
}
