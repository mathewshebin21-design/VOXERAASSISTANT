"use client";

import { clsx } from "clsx";
import { Check, Circle, Send, Sparkles, Wand2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Chip, FBtn, Glass, GHead } from "./ui";
import { api, ApiError, type Agent, type BusinessProfile, type HoursInterval, type Service, type WorkspaceSettings } from "@/lib/live/api";
import { savedFrom, type Change } from "@/lib/setup/commands";
import { advance, prompt, reply, STEP_LABEL, STEPS, type GuidedState, type SetupAction, type StepId } from "@/lib/setup/guided";

type Line = { id: number; from: "assistant" | "you" | "saved" | "error"; text: string };
interface Snapshot { profile: BusinessProfile; hours: HoursInterval[]; services: Service[]; agents: Agent[]; settings: WorkspaceSettings | null }

const TOOL_LABEL: Record<string, string> = {
  get_setup_state: "Checked what's set up", update_business_details: "Saved business details", set_opening_hours: "Saved opening hours",
  add_services: "Saved services", set_booking_capacity: "Saved capacity", create_receptionist: "Created your receptionist",
  update_service: "Updated a service", remove_services: "Removed services", update_receptionist: "Updated your receptionist",
  get_business_template: "Looked up the template",
};

function doneSteps(s: Snapshot | null): Set<StepId> {
  const d = new Set<StepId>();
  if (!s) return d;
  if (s.profile.phone) d.add("phone");
  if (s.profile.city || s.profile.address_line1) d.add("address");
  if (s.hours.length) d.add("hours");
  if (s.services.some((x) => x.active)) d.add("services");
  if ((s.settings?.booking_capacity ?? 1) > 1) d.add("capacity");
  if (s.agents.length) d.add("receptionist");
  return d;
}

/** Sets a workspace up by conversation. Uses the AI model when one is configured (Claude, Gemini, Groq…), otherwise a free guided mode. */
export function SetupAssistant({ orgId, firstName }: { orgId: string; firstName: string }) {
  const base = `/orgs/${orgId}`;
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [mode, setMode] = useState<"guided" | "ai">("guided");
  const [lines, setLines] = useState<Line[]>([]);
  const [guided, setGuided] = useState<GuidedState | null>(null);
  const [aiHistory, setAiHistory] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const ids = useRef(1);
  const end = useRef<HTMLDivElement>(null);
  const say = useCallback((from: Line["from"], t: string) => setLines((l) => [...l, { id: ids.current++, from, text: t }]), []);

  const load = useCallback(async () => {
    const [profile, hours, services, agents, settings] = await Promise.all([
      api<BusinessProfile>(`${base}/business-profile`),
      api<{ intervals: HoursInterval[] }>(`${base}/office-hours`).then((h) => h.intervals),
      api<Service[]>(`${base}/services`),
      api<Agent[]>(`${base}/agents`),
      api<WorkspaceSettings>(`${base}/settings`).catch(() => null),
    ]);
    const s = { profile, hours, services, agents, settings };
    setSnap(s);
    return s;
  }, [base]);

  // First load: what's done, whether Claude is available, and the opening message.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [s, status] = await Promise.all([load(), api<{ ai: boolean }>(`${base}/live/setup-assistant/status`).catch(() => ({ ai: false }))]);
      if (cancelled) return;
      setAiAvailable(status.ai);
      const done = doneSteps(s);
      const start: GuidedState = { step: "type", businessName: s.profile.display_name, sector: s.profile.sector, pending: null };
      setGuided(start);
      say("assistant", `Hi ${firstName}! I'll help you set up ${s.profile.display_name} so your receptionist knows your business. I'll ask one thing at a time — say “skip” for anything you'd rather do later.`);
      if (done.size) say("assistant", `Already done: ${[...done].map((d) => STEP_LABEL[d]).join(", ")}.`);
      say("assistant", prompt("type", s.profile.display_name));
    })();
    return () => { cancelled = true; };
  }, [base, firstName, load, say]);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [lines]);

  const perform = async (a: SetupAction): Promise<string> => {
    switch (a.type) {
      case "profile": {
        const p = await api<BusinessProfile>(`${base}/business-profile`);
        await api(`${base}/business-profile`, { method: "PUT", body: { ...p, ...Object.fromEntries(Object.entries(a.patch).filter(([, v]) => v !== null && v !== undefined)) } });
        return "Saved to your business details";
      }
      case "hours":
        await api(`${base}/office-hours`, { method: "PUT", body: { intervals: a.week.flatMap((periods, weekday) => periods.map((p) => ({ weekday, opens_at: p.opens, closes_at: p.closes }))) } });
        return "Opening hours saved";
      case "services": {
        let added = 0, existed = 0;
        for (const s of a.services) {
          const extra = { ...(s.category ? { category: s.category } : {}), ...(s.buffer_min !== undefined ? { buffer_min: s.buffer_min } : {}) };
          try { await api(`${base}/services`, { method: "POST", body: { name: s.name, duration_min: s.duration_min, price_from_pence: s.price_from_pence, requires_patch_test: s.requires_patch_test, ...extra } }); added++; }
          catch (e) { if (e instanceof ApiError && e.status === 409) existed++; else throw e; }
        }
        let policies = "";
        if (a.description) {
          const p = await api<BusinessProfile>(`${base}/business-profile`);
          if (p.description?.trim()) policies = "; kept your existing business description";
          else { await api(`${base}/business-profile`, { method: "PUT", body: { ...p, description: a.description } }); policies = "; booking policies added to your business description"; }
        }
        return `${added} service${added === 1 ? "" : "s"} saved${existed ? ` (${existed} already existed)` : ""}${policies}`;
      }
      case "capacity":
        await api(`${base}/settings`, { method: "PATCH", body: { booking_capacity: a.capacity } });
        return "Capacity saved";
      case "agent":
        await api(`${base}/agents`, { method: "POST", body: { name: a.name, greeting: a.greeting } });
        return `${a.name} created`;
      case "changes":
        for (const c of a.changes) await applyChange(c);
        return "Saved to your workspace";
    }
  };

  /** One change asked for in the owner's words. Services are found by their current name. */
  const applyChange = async (c: Change) => {
    const services = () => api<Service[]>(`${base}/services`);
    const byName = (list: Service[], name: string) => list.find((s) => s.name.toLowerCase() === name.toLowerCase());
    switch (c.kind) {
      case "hours":
        await api(`${base}/office-hours`, { method: "PUT", body: { intervals: c.week.flatMap((periods, weekday) => periods.map((p) => ({ weekday, opens_at: p.opens, closes_at: p.closes }))) } });
        return;
      case "service_update": {
        const s = byName(await services(), c.name);
        if (!s) throw new Error(`I couldn't find ${c.name} any more — it may have been changed in Workspace.`);
        await api(`${base}/services/${s.id}`, { method: "PATCH", body: c.patch });
        return;
      }
      case "service_remove": {
        // Hidden from callers rather than erased: bookings keep their service, and "undo" brings back the same one.
        const list = await services();
        for (const n of c.names) { const s = byName(list, n); if (s) await api(`${base}/services/${s.id}`, { method: "PATCH", body: { active: false } }); }
        return;
      }
      case "service_add": {
        const all = await api<Service[]>(`${base}/services?include_inactive=true`);
        for (const s of c.services) {
          const fields = { duration_min: s.duration_min, price_from_pence: s.price_from_pence, category: s.category, buffer_min: s.buffer_min, requires_patch_test: s.requires_patch_test };
          const old = byName(all, s.name);
          if (old && !old.active) { await api(`${base}/services/${old.id}`, { method: "PATCH", body: { ...fields, active: true } }); continue; }
          if (old) continue; // already offered
          try { await api(`${base}/services`, { method: "POST", body: { name: s.name, ...fields } }); }
          catch (e) { if (!(e instanceof ApiError && e.status === 409)) throw e; }
        }
        return;
      }
      case "profile": {
        const p = await api<BusinessProfile>(`${base}/business-profile`);
        await api(`${base}/business-profile`, { method: "PUT", body: { ...p, ...c.patch } });
        return;
      }
      case "capacity":
        await api(`${base}/settings`, { method: "PATCH", body: { booking_capacity: c.capacity } });
        return;
      case "receptionist": {
        const [agent] = await api<Agent[]>(`${base}/agents`);
        if (!agent) throw new Error("There's no receptionist to change yet.");
        await api(`${base}/agents/${agent.id}`, { method: "PATCH", body: c.patch });
        return;
      }
    }
  };

  const sendGuided = async (input: string) => {
    if (!guided || !snap) return;
    const skip = doneSteps(snap);
    const t = reply({ ...guided, saved: savedFrom(snap) }, input, skip);
    if (!t.action) { t.say.forEach((m) => say("assistant", m)); setGuided(t.state); return; }
    // For a change to what's saved, say what was done only once it has been saved.
    const [first, ...rest] = t.stay ? t.say : [];
    if (!t.stay) t.say.forEach((m) => say("assistant", m));
    try {
      const saved = await perform(t.action);
      const s = await load();
      if (t.stay) {
        say("assistant", first);
        say("saved", `✓ ${saved}`);
        rest.forEach((m) => say("assistant", m));
        setGuided({ ...t.state, saved: savedFrom(s) });
        return;
      }
      say("saved", `✓ ${saved}`);
      const n = advance(t.state, doneSteps(s));
      setGuided(n.state);
      n.say.forEach((m) => say("assistant", m));
    } catch (e) {
      const why = e instanceof ApiError ? e.detail : e instanceof Error ? e.message : "please try again";
      say("error", `Couldn't save that: ${why}`);
      await load().catch(() => null);
      setGuided({ ...t.state, pending: t.stay ? t.state.pending : null, undo: t.stay ? guided.undo : t.state.undo });
    }
  };

  const sendAi = async (input: string) => {
    const history = [...aiHistory, { role: "user" as const, text: input }];
    setAiHistory(history);
    const r = await fetch(`/api/v1${base}/live/setup-assistant`, {
      method: "POST", headers: { "content-type": "application/json", "x-voxera-csrf": "1" },
      body: JSON.stringify({ request_id: `setup-${crypto.randomUUID()}`, messages: history.slice(-60) }),
    });
    if (!r.ok || !r.body) {
      const detail = await r.json().then((j) => j.detail).catch(() => `HTTP ${r.status}`);
      say("error", `The AI assistant isn't available (${detail}). Switching to step-by-step mode.`);
      setMode("guided");
      return;
    }
    const id = ids.current++;
    let said = "";
    setLines((l) => [...l, { id, from: "assistant", text: "" }]);
    const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const line = buf.slice(0, i).split("\n").find((x) => x.startsWith("data: "));
        buf = buf.slice(i + 2);
        if (!line) continue;
        const e = JSON.parse(line.slice(6)) as { type: string; text?: string; name?: string; ok?: boolean; result?: string; message?: string };
        if (e.type === "text" && e.text) { said += e.text; setLines((l) => l.map((x) => (x.id === id ? { ...x, text: said } : x))); }
        else if (e.type === "tool" && e.name !== "get_setup_state") say(e.ok ? "saved" : "error", e.ok ? `✓ ${TOOL_LABEL[e.name ?? ""] ?? e.name}` : `Couldn't save: ${e.result}`);
        else if (e.type === "error") say("error", e.message ?? "Something went wrong");
      }
    }
    if (said) setAiHistory((h) => [...h, { role: "assistant", text: said }]);
    await load();
  };

  const send = async (input: string) => {
    if (!input.trim() || busy) return;
    say("you", input.trim());
    setText("");
    setBusy(true);
    try { await (mode === "ai" ? sendAi(input.trim()) : sendGuided(input.trim())); } finally { setBusy(false); }
  };

  const done = doneSteps(snap);
  const quick = mode === "guided" && guided ? (guided.pending ? ["Yes, save it"] : guided.step === "done" ? [] : ["Skip"]) : [];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
      <Glass glow="violet" className="flex h-[calc(100vh-220px)] min-h-[480px] flex-col">
        <GHead
          title={<span className="flex items-center gap-2"><Wand2 size={14} /> Setup assistant</span>}
          right={aiAvailable ? (
            <div className="flex rounded-lg border border-flw-line p-0.5 text-[11px]" role="radiogroup" aria-label="Assistant mode">
              {(["guided", "ai"] as const).map((m) => <button key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={clsx("rounded-md px-2 py-0.5", mode === m ? "bg-flw-violet/25 text-flw-text" : "text-flw-mute")}>{m === "ai" ? "AI chat" : "Step by step"}</button>)}
            </div>
          ) : <Chip tone="cyan">step by step · free</Chip>}
        />
        <div className="flex-1 space-y-2.5 overflow-y-auto p-4" aria-live="polite" data-testid="setup-chat">
          {lines.map((l) => (
            <div key={l.id} className={clsx("max-w-[88%] whitespace-pre-line text-sm",
              l.from === "you" && "ml-auto rounded-2xl rounded-br-md bg-flw-line/70 px-3.5 py-2",
              l.from === "assistant" && "rounded-2xl rounded-bl-md border border-flw-violet/40 bg-flw-violet/10 px-3.5 py-2",
              l.from === "saved" && "font-mono text-[11px] text-flw-lime",
              l.from === "error" && "text-xs text-flw-pink")} role={l.from === "error" ? "alert" : undefined}>
              {l.text || (l.from === "assistant" ? "…" : "")}
            </div>
          ))}
          {busy && <div className="font-mono text-[11px] text-flw-mute">working…</div>}
          <div ref={end} />
        </div>
        {quick.length > 0 && <div className="flex gap-2 px-3 pb-2">{quick.map((q) => <button key={q} onClick={() => void send(q)} className="rounded-full border border-flw-line px-3 py-1 text-xs hover:border-flw-cyan">{q}</button>)}</div>}
        <form onSubmit={(e) => { e.preventDefault(); void send(text); }} className="flex items-end gap-2 border-t border-flw-line/70 p-3">
          <textarea aria-label="Your answer" rows={guided?.step === "services" || guided?.step === "hours" ? 3 : 1} value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && guided?.step !== "services") { e.preventDefault(); void send(text); } }}
            placeholder={mode === "ai" ? "Tell the assistant about your business, or what to change…" : guided?.step === "services" ? "One service per line, then press Send" : guided?.step === "done" ? "Tell me what to change — e.g. “skin fade is now £25”" : "Type your answer, or tell me what to change…"}
            className="min-w-0 flex-1 resize-none rounded-xl border border-flw-line bg-flw-bg/70 px-3 py-2 text-sm outline-none focus:border-flw-cyan" />
          <FBtn type="submit" variant="glow" aria-label="Send" disabled={busy || !text.trim()}><Send size={14} /></FBtn>
        </form>
      </Glass>
      <Glass className="self-start">
        <GHead title="Your setup" right={<span className="font-mono text-[11px] text-flw-mute">{done.size}/{STEPS.length - 2}</span>} />
        <ul className="space-y-2 p-4 text-sm" data-testid="setup-steps">
          {STEPS.filter((s) => s !== "done" && s !== "type").map((s) => (
            <li key={s} className={clsx("flex items-center gap-2", guided?.step === s && "text-flw-cyan")}>
              {done.has(s) ? <Check size={14} className="text-flw-lime" /> : <Circle size={14} className="text-flw-mute" />}
              <span className={done.has(s) ? "text-flw-mute" : ""}>{STEP_LABEL[s]}</span>
              {guided?.step === s && <span className="ml-auto font-mono text-[10px]">now</span>}
            </li>
          ))}
        </ul>
        <div className="space-y-1.5 border-t border-flw-line/70 p-4 text-xs text-flw-mute">
          <p className="flex items-center gap-1.5"><Sparkles size={12} /> {aiAvailable ? "AI chat takes free-form answers." : "Free guided mode. With an AI model connected on the server (Claude, Gemini, Groq…), the assistant also understands free-form chat."}</p>
          <p>Everything is saved straight to your workspace. To change something later, just tell the assistant (“we&rsquo;re closed on Mondays now”) and say “undo” if it&rsquo;s wrong — or edit it in <Link href="/flow/app/workspace" className="text-flw-cyan hover:underline">Workspace</Link>.</p>
        </div>
      </Glass>
    </div>
  );
}
