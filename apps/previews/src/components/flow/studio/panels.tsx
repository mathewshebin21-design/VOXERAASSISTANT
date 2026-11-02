"use client";

import { clsx } from "clsx";
import { AlertTriangle, Check, ChevronDown, ChevronRight, CircleSlash, FlaskConical, History, Play, RotateCcw, Send, ShieldAlert, Sparkles, Undo2, Wrench, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Chip, FBtn, finput, Glass } from "@/components/flow/ui";
import { api, ApiError } from "@/lib/live/api";
import type { FlowDoc } from "@/lib/studio/graph";

export type Ev =
  | { type: "say"; text: string; node: string }
  | { type: "caller"; text: string }
  | { type: "node"; node: string; kind: string; label: string }
  | { type: "tool"; name: string; node: string; ok: boolean; args: Record<string, unknown>; result: string; latency_ms: number; written: boolean }
  | { type: "guardrail"; rule: string; text: string; node: string | null }
  | { type: "evidence"; source: string; value: string; node: string }
  | { type: "end"; outcome: string };

export function Transcript({ events, compact = false }: { events: Ev[]; compact?: boolean }) {
  return (
    <div className="space-y-2">
      {events.map((e, i) => {
        if (e.type === "caller") return <div key={i} className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-flw-line/70 px-3 py-1.5 text-sm">{e.text}</div>;
        if (e.type === "say") return <div key={i} className="max-w-[90%] rounded-2xl rounded-bl-md border border-flw-violet/40 bg-flw-violet/10 px-3 py-1.5 text-sm">{e.text}</div>;
        if (e.type === "tool") return <div key={i} className={clsx("flex flex-wrap items-center gap-1.5 font-mono text-[11px]", e.ok ? "text-flw-cyan" : "text-flw-pink")}><Wrench size={11} />{e.name} {e.ok ? "✓" : "✗"} <span className="text-flw-mute">{e.result}{e.latency_ms ? ` · ${e.latency_ms} ms` : ""}</span></div>;
        if (e.type === "guardrail") return <div key={i} className="flex items-start gap-1.5 font-mono text-[11px] text-flw-amber"><ShieldAlert size={11} className="mt-0.5" />{e.rule.replace(/_/g, " ")}{!compact && <span className="text-flw-mute"> — {e.text}</span>}</div>;
        if (e.type === "evidence" && !compact) return <div key={i} className="font-mono text-[10px] text-flw-mute">§ from {e.source}</div>;
        if (e.type === "end") return <div key={i} className="text-center font-mono text-[10px] uppercase tracking-widest text-flw-mute">call ended · {e.outcome.replace(/_/g, " ")}</div>;
        return null;
      })}
    </div>
  );
}

/** A text conversation through the draft (or published) flow. Actions are checked for real and rolled back. */
export function TestCall({ base, onPath, dirty }: { base: string; onPath: (active: string | null, visited: string[]) => void; dirty: boolean }) {
  const [session, setSession] = useState<string | null>(null);
  const [events, setEvents] = useState<Ev[]>([]);
  const [ended, setEnded] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [events]);
  useEffect(() => {
    const visited = events.filter((e) => e.type === "node").map((e) => (e as { node: string }).node);
    onPath(visited.at(-1) ?? null, visited);
  }, [events, onPath]);

  const start = async (source: "draft" | "published") => {
    setErr(null); setBusy(true);
    try {
      const r = await api<{ session_id: string; events: Ev[] }>(`${base}/sessions`, { method: "POST", body: { source } });
      setSession(r.session_id); setEvents(r.events); setEnded(false);
    } catch (e) { setErr(e instanceof ApiError ? e.detail : "Couldn't start the test call"); }
    finally { setBusy(false); }
  };
  const send = async () => {
    if (!session || !text.trim()) return;
    const said = text.trim();
    setText(""); setBusy(true); setErr(null);
    setEvents((ev) => [...ev, { type: "caller", text: said }]);
    try {
      const r = await api<{ events: Ev[]; ended: boolean }>(`${base}/sessions/${session}/turn`, { method: "POST", body: { text: said } });
      setEvents((ev) => [...ev, ...r.events]); setEnded(r.ended);
    } catch (e) { setErr(e instanceof ApiError ? e.detail : "That didn't go through"); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="test-call">
      <div className="flex flex-wrap items-center gap-2 border-b border-flw-line/70 p-3">
        <FBtn variant="glow" onClick={() => start("draft")} disabled={busy}><Play size={13} /> {session ? "Restart" : "Test the draft"}</FBtn>
        <FBtn onClick={() => start("published")} disabled={busy}>Published</FBtn>
        {dirty && <span className="text-[11px] text-flw-amber">Saving… the call uses the last saved draft</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3" aria-live="polite">
        {!session ? <p className="text-sm text-flw-mute">Talk to your receptionist as a caller would. It follows this flow step by step and the canvas lights up its path. Bookings and hand-overs are checked against your real diary and team, then undone: nothing is saved. This is a text test; voice isn&apos;t involved.</p> : <Transcript events={events} />}
        {err && <p role="alert" className="mt-2 text-sm text-flw-pink">{err}</p>}
        <div ref={end} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="flex gap-2 border-t border-flw-line/70 p-3">
        <input aria-label="Say as the caller" className={finput} disabled={!session || ended || busy} value={text} onChange={(e) => setText(e.target.value)} placeholder={ended ? "Call ended — restart to try again" : "Type as the caller…"} />
        <FBtn type="submit" variant="glow" aria-label="Send" disabled={!session || ended || busy || !text.trim()}><Send size={14} /></FBtn>
      </form>
    </div>
  );
}

type Assertion = { type: string; value: string; status: "passed" | "failed" | "skipped"; actual: string; graded_by: "rule" | "model" };
export type TestResult = { test_id: string; name: string; passed: boolean; error: string | null; assertions: Assertion[]; outcome: string | null; transcript: Ev[]; tool_calls: { name: string; ok: boolean; result: string; latency_ms: number }[]; latency_ms: number; tokens: number; estimated_cost_gbp: number; kind: string };
export type Suite = { summary: { total: number; passed: number; failed: number; model_graded_skipped: number }; results: TestResult[] };
type Scenario = { name: string; lines: string[]; assertions: { type: string; value: string }[]; fail_tools?: boolean; hours?: string; staff?: string };

export function SuiteResults({ suite }: { suite: Suite }) {
  const [open, setOpen] = useState<string | null>(null);
  const s = suite.summary;
  return (
    <div className="space-y-2" data-testid="suite-results">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Chip tone={s.failed ? "pink" : "lime"}>{s.passed}/{s.total} passed</Chip>
        {s.model_graded_skipped > 0 && <Chip tone="amber">{s.model_graded_skipped} model-graded skipped</Chip>}
        <span className="text-[11px] text-flw-mute">Text simulation: voice, speech recognition and phone-line latency aren&apos;t tested.</span>
      </div>
      {suite.results.map((r) => (
        <div key={r.test_id} className={clsx("rounded-xl border", r.passed ? "border-flw-line/70" : "border-flw-pink/50")}>
          <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm" onClick={() => setOpen(open === r.test_id ? null : r.test_id)} aria-expanded={open === r.test_id}>
            {r.passed ? <Check size={14} className="text-flw-lime" /> : <X size={14} className="text-flw-pink" />}
            <span className="flex-1 truncate">{r.name}</span>
            <span className="font-mono text-[10px] text-flw-mute">{r.latency_ms} ms · {r.tool_calls.length} tool{r.tool_calls.length === 1 ? "" : "s"}</span>
            {open === r.test_id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {open === r.test_id && (
            <div className="space-y-3 border-t border-flw-line/60 p-3">
              {r.error && <p className="text-xs text-flw-pink">Error: {r.error}</p>}
              <ul className="space-y-1">
                {r.assertions.map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    {a.status === "passed" ? <Check size={12} className="mt-0.5 text-flw-lime" /> : a.status === "failed" ? <X size={12} className="mt-0.5 text-flw-pink" /> : <CircleSlash size={12} className="mt-0.5 text-flw-amber" />}
                    <span><span className="font-mono">{a.type.replace(/_/g, " ")}</span> “{a.value}” <span className="text-flw-mute">· {a.graded_by === "model" ? "model-graded" : "rule"} · saw: {a.actual}</span></span>
                  </li>
                ))}
              </ul>
              <div className="font-mono text-[10px] text-flw-mute">outcome {r.outcome ?? "—"} · tokens {r.tokens} · est. cost £{r.estimated_cost_gbp.toFixed(2)}</div>
              <Transcript events={r.transcript} compact />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const ASSERTION_TYPES = ["says", "not_says", "outcome", "ended", "tool_called", "tool_not_called", "tool_failed", "guardrail", "reached_node", "not_reached_node", "judge"];

export function TestsPanel({ base, canEdit }: { base: string; canEdit: boolean }) {
  const [tests, setTests] = useState<{ id: string; scenario: Scenario }[] | null>(null);
  const [suite, setSuite] = useState<Suite | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; lines: string; says: string } | null>(null);
  const load = async () => { try { setTests(await api(`${base}/tests`)); } catch (e) { setErr(e instanceof ApiError ? e.detail : "Couldn't load tests"); } };
  useEffect(() => { void load(); }, [base]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (source: "draft" | "published") => {
    setBusy(true); setErr(null);
    try { setSuite(await api<Suite>(`${base}/tests/run`, { method: "POST", body: { source } })); }
    catch (e) { setErr(e instanceof ApiError ? e.detail : "Couldn't run the tests"); }
    finally { setBusy(false); }
  };
  const add = async () => {
    if (!draft) return;
    const lines = draft.lines.split("\n").map((l) => l.trim()).filter(Boolean);
    try {
      await api(`${base}/tests`, { method: "POST", body: { scenario: { name: draft.name, lines, assertions: [{ type: "says", value: draft.says }] } } });
      setDraft(null); await load();
    } catch (e) { setErr(e instanceof ApiError ? e.detail : "Couldn't save the test"); }
  };
  const remove = async (id: string) => { try { await api(`${base}/tests/${id}`, { method: "DELETE" }); await load(); } catch (e) { setErr(e instanceof ApiError ? e.detail : "Couldn't delete"); } };

  return (
    <div className="space-y-3 p-3" data-testid="tests-panel">
      <div className="flex flex-wrap gap-2">
        <FBtn variant="glow" onClick={() => run("draft")} disabled={busy}><FlaskConical size={13} /> {busy ? "Running…" : "Run all on the draft"}</FBtn>
        <FBtn onClick={() => run("published")} disabled={busy}>On published</FBtn>
        {canEdit && <FBtn onClick={() => setDraft({ name: "", lines: "", says: "" })}>New test</FBtn>}
      </div>
      <p className="text-[11px] text-flw-mute">Publishing runs every test first and is refused if any fails. Checks are rules (exact). “Judge” checks need an approved AI provider and are skipped until then — never counted as passed.</p>
      {err && <p role="alert" className="text-sm text-flw-pink">{err}</p>}
      {draft && (
        <Glass className="space-y-2 p-3">
          <input aria-label="Test name" className={finput} placeholder="Name, e.g. Asks about parking" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <textarea aria-label="Caller lines" className={clsx(finput, "min-h-[72px]")} placeholder={"What the caller says, one line each\ne.g. Is there parking?"} value={draft.lines} onChange={(e) => setDraft({ ...draft, lines: e.target.value })} />
          <input aria-label="Receptionist should say" className={finput} placeholder="The receptionist should say… (e.g. free parking)" value={draft.says} onChange={(e) => setDraft({ ...draft, says: e.target.value })} />
          <div className="flex gap-2"><FBtn variant="glow" onClick={add} disabled={!draft.name || !draft.lines.trim() || !draft.says}>Save test</FBtn><FBtn onClick={() => setDraft(null)}>Cancel</FBtn></div>
        </Glass>
      )}
      {suite ? <SuiteResults suite={suite} /> : (
        <ul className="space-y-1.5">
          {(tests ?? []).map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 rounded-xl border border-flw-line/60 px-3 py-2 text-sm">
              <span className="min-w-0"><span className="block truncate">{t.scenario.name}</span><span className="block truncate font-mono text-[10px] text-flw-mute">{t.scenario.lines.length} line(s) · {t.scenario.assertions.map((a) => a.type).filter((x) => ASSERTION_TYPES.includes(x)).join(", ")}</span></span>
              {canEdit && <button aria-label={`Delete test ${t.scenario.name}`} onClick={() => remove(t.id)} className="text-flw-mute hover:text-flw-pink"><X size={14} /></button>}
            </li>
          ))}
        </ul>
      )}
      {suite && <FBtn onClick={() => setSuite(null)}>Back to the list</FBtn>}
    </div>
  );
}

export type Version = { version: number; note: string; source: string; restored_from: number | null; created_at: string; tests: Suite["summary"] | null };

export function VersionsPanel({ base, versions, published, canEdit, onChanged }: { base: string; versions: Version[]; published: number | null; canEdit: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const act = async (v: number, what: "rollback" | "restore") => {
    if (what === "rollback" && !window.confirm(`Make v${v} live again? Callers will get it straight away.`)) return;
    setBusy(v); setErr(null);
    try { await api(`${base}/versions/${v}/${what}`, { method: "POST", body: what === "rollback" ? { note: "" } : undefined }); onChanged(); }
    catch (e) { setErr(e instanceof ApiError ? e.detail : "That didn't work"); }
    finally { setBusy(null); }
  };
  return (
    <div className="space-y-2 p-3" data-testid="versions-panel">
      <p className="text-[11px] text-flw-mute">Each publish is kept forever. Callers always get the live version; your draft never changes it until you publish.</p>
      {err && <p role="alert" className="text-sm text-flw-pink">{err}</p>}
      {!versions.length && <p className="text-sm text-flw-mute">Nothing published yet.</p>}
      {versions.map((v) => (
        <div key={v.version} className="rounded-xl border border-flw-line/60 p-3">
          <div className="flex items-center gap-2">
            <span className="font-display font-medium">v{v.version}</span>
            {v.version === published && <Chip tone="lime">live</Chip>}
            {v.source === "rollback" && <Chip tone="amber">rollback of v{v.restored_from}</Chip>}
            <span className="ml-auto font-mono text-[10px] text-flw-mute">{new Date(v.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>
          </div>
          {v.note && <p className="mt-1 text-xs text-flw-mute">{v.note}</p>}
          {v.tests && <p className="mt-1 font-mono text-[10px] text-flw-mute">tests {v.tests.passed}/{v.tests.total} passed</p>}
          {canEdit && (
            <div className="mt-2 flex gap-2">
              {v.version !== published && <FBtn onClick={() => act(v.version, "rollback")} disabled={busy !== null}><RotateCcw size={12} /> Make live</FBtn>}
              <FBtn onClick={() => act(v.version, "restore")} disabled={busy !== null}><History size={12} /> Edit a copy</FBtn>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

type Insights = {
  label: string; conversations: number; outcomes: Record<string, number>; resolved: number; booking_conversion: { wanted: number; booked: number; rate: number | null };
  escalations: number; transfers: number; failed_tool_calls: Record<string, number>; knowledge_gaps: { question: string; count: number }[];
  common_questions: { question: string; count: number }[]; average_turns: number | null; tool_latency_ms: { average: number | null; max: number | null; note: string };
  model: { tokens: number; estimated_cost_gbp: number; note: string }; trend: Record<string, string | number>[];
};

export function InsightsPanel({ base }: { base: string }) {
  const [mode, setMode] = useState<"simulation" | "live">("simulation");
  const [data, setData] = useState<Insights | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setData(null); api<Insights>(`${base}/insights?mode=${mode}`).then(setData, (e) => setErr(e instanceof ApiError ? e.detail : "Couldn't load insights")); }, [base, mode]);
  const stat = (label: string, value: string | number) => <div className="rounded-xl border border-flw-line/60 p-2.5"><div className="font-display text-lg">{value}</div><div className="text-[11px] text-flw-mute">{label}</div></div>;
  return (
    <div className="space-y-3 p-3" data-testid="insights-panel">
      <div className="grid grid-cols-2 rounded-xl border border-flw-line p-1 text-xs" role="tablist">
        {(["simulation", "live"] as const).map((m) => <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={clsx("rounded-lg py-1.5", mode === m ? "bg-flw-violet/25 text-flw-text" : "text-flw-mute")}>{m === "simulation" ? "Simulated" : "Real calls"}</button>)}
      </div>
      {err && <p role="alert" className="text-sm text-flw-pink">{err}</p>}
      {data && (
        <>
          <p className="text-[11px] text-flw-amber">{data.label} · last 30 days</p>
          {data.conversations === 0 ? <p className="text-sm text-flw-mute">{mode === "live" ? "No real calls yet. Phone numbers aren't connected." : "No simulated conversations yet. Use Test call."}</p> : (
            <>
              <div className="grid grid-cols-2 gap-2">
                {stat("conversations", data.conversations)}
                {stat("resolved", data.resolved)}
                {stat("booking conversion", data.booking_conversion.rate === null ? "—" : `${Math.round(data.booking_conversion.rate * 100)}% (${data.booking_conversion.booked}/${data.booking_conversion.wanted})`)}
                {stat("passed to the team", data.escalations + data.transfers)}
                {stat("failed tool calls", Object.values(data.failed_tool_calls).reduce((a, b) => a + b, 0))}
                {stat("avg caller turns", data.average_turns ?? "—")}
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-flw-mute">Knowledge gaps (asked, not answered)</div>
                {data.knowledge_gaps.length ? <ul className="space-y-1 text-xs">{data.knowledge_gaps.map((g) => <li key={g.question} className="flex justify-between gap-2"><span className="truncate">{g.question}</span><span className="font-mono text-flw-mute">×{g.count}</span></li>)}</ul> : <p className="text-xs text-flw-mute">None — every question was answered or routed.</p>}
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-flw-mute">Common questions</div>
                <ul className="space-y-1 text-xs">{data.common_questions.map((g) => <li key={g.question} className="flex justify-between gap-2"><span className="truncate">{g.question}</span><span className="font-mono text-flw-mute">×{g.count}</span></li>)}</ul>
              </div>
              <p className="text-[11px] text-flw-mute">Tool time: avg {data.tool_latency_ms.average ?? "—"} ms. {data.tool_latency_ms.note} {data.model.note}</p>
            </>
          )}
        </>
      )}
    </div>
  );
}

export type Change = { kind: string; node: string; text: string; before?: unknown; after?: unknown };
export type Proposal = { understood: true; summary: string; impact: "normal" | "high"; requires_confirmation: boolean; changes: Change[]; notes: string[]; graph: FlowDoc; validation: { ok: boolean; errors: number; issues: { message: string; severity: string }[] }; base_revision: number };

const show = (v: unknown) => (v === undefined || v === null ? "—" : typeof v === "string" ? v : JSON.stringify(v));

export function ChangeByAsking({ base, onApply, disabled }: { base: string; onApply: (p: Proposal) => void; disabled: boolean }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [miss, setMiss] = useState<{ message: string; examples: string[] } | null>(null);
  const ask = async () => {
    setBusy(true); setMiss(null); setProposal(null);
    try {
      const r = await api<Proposal | { understood: false; message: string; examples: string[] }>(`${base}/instructions`, { method: "POST", body: { text } });
      if (r.understood) setProposal(r); else setMiss(r);
    } catch (e) { setMiss({ message: e instanceof ApiError ? e.detail : "That didn't go through", examples: [] }); }
    finally { setBusy(false); }
  };
  return (
    <div className="relative" data-testid="change-by-asking">
      <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) void ask(); }} className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Sparkles size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-flw-violet" />
          <input aria-label="Describe a change" disabled={disabled} className={clsx(finput, "pl-9")} placeholder="Describe a change, e.g. “Don’t accept appointments on Sundays”" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <FBtn type="submit" variant="glow" disabled={busy || disabled || !text.trim()}>{busy ? "Thinking…" : "Propose"}</FBtn>
      </form>
      {miss && (
        <Glass className="absolute left-0 right-0 top-12 z-20 p-4">
          <div className="flex items-start gap-2 text-sm"><AlertTriangle size={15} className="mt-0.5 text-flw-amber" /><span>{miss.message}</span><button aria-label="Close" onClick={() => setMiss(null)} className="ml-auto text-flw-mute"><X size={14} /></button></div>
          {miss.examples.length > 0 && <><p className="mt-2 text-xs text-flw-mute">Things I can do:</p><ul className="mt-1 space-y-1">{miss.examples.map((x) => <li key={x}><button className="text-left text-xs text-flw-cyan hover:underline" onClick={() => { setText(x); setMiss(null); }}>{x}</button></li>)}</ul></>}
        </Glass>
      )}
      {proposal && (
        <Glass glow="violet" className="absolute left-0 right-0 top-12 z-20 max-h-[70vh] overflow-y-auto p-4" >
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <div className="font-medium">{proposal.summary}</div>
              <div className="mt-1 flex flex-wrap gap-1.5">{proposal.impact === "high" && <Chip tone="amber">high impact</Chip>}<Chip tone={proposal.validation.ok ? "lime" : "pink"}>{proposal.validation.ok ? "valid flow" : `${proposal.validation.errors} problem(s)`}</Chip><Chip tone="mute">draft only — not live until you publish</Chip></div>
            </div>
            <button aria-label="Close" onClick={() => setProposal(null)} className="text-flw-mute"><X size={14} /></button>
          </div>
          <div className="mt-3 text-xs font-medium text-flw-mute">Before → after</div>
          <ul className="mt-1 space-y-1.5" aria-label="Proposed changes">
            {proposal.changes.map((c, i) => (
              <li key={i} className="rounded-lg border border-flw-line/60 px-2.5 py-1.5 text-xs">
                <div>{c.text}</div>
                {c.kind === "changed_setting" && <div className="mt-1 grid grid-cols-2 gap-2 font-mono text-[10px]"><span className="text-flw-pink line-through decoration-flw-pink/50">{show(c.before)}</span><span className="text-flw-lime">{show(c.after)}</span></div>}
              </li>
            ))}
          </ul>
          {proposal.notes.map((n) => <p key={n} className="mt-2 text-xs text-flw-mute">{n}</p>)}
          {!proposal.validation.ok && <ul className="mt-2 space-y-1 text-xs text-flw-pink">{proposal.validation.issues.filter((i) => i.severity === "error").map((i, k) => <li key={k}>{i.message}</li>)}</ul>}
          <div className="mt-3 flex gap-2">
            <FBtn variant="glow" onClick={() => { onApply(proposal); setProposal(null); setText(""); }}><Check size={13} /> Apply to draft</FBtn>
            <FBtn onClick={() => setProposal(null)}><Undo2 size={13} /> Discard</FBtn>
          </div>
        </Glass>
      )}
    </div>
  );
}
