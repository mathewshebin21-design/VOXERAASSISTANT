"use client";

import { clsx } from "clsx";
import { AlertTriangle, BarChart3, Check, CloudOff, FlaskConical, GitBranch, Loader2, MousePointerClick, Phone, Redo2, Rocket, SlidersHorizontal, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NeedsSignIn, Notice } from "@/components/flow/live-ui";
import { NODE_ICON, StudioCanvas, type Issue } from "@/components/flow/studio/canvas";
import { Inspector } from "@/components/flow/studio/inspector";
import { ChangeByAsking, InsightsPanel, SuiteResults, TestCall, TestsPanel, VersionsPanel, type Proposal, type Suite, type Version } from "@/components/flow/studio/panels";
import { Chip, FBtn, finput, Glass, Heading } from "@/components/flow/ui";
import { api, ApiError, PERMS, type Agent } from "@/lib/live/api";
import { useActiveOrg, useApi, useSession } from "@/lib/live/session";
import { addNode, commit, disconnect, history, NODE_META, PALETTE, redo, removeNode, undo, updateNode, type FlowDoc, type History, type NodeType } from "@/lib/studio/graph";

type Validation = { ok: boolean; errors: number; warnings: number; issues: Issue[] };
type FlowState = { revision: number; draft: FlowDoc; published_version: number | null; draft_differs: boolean; validation: Validation; versions: Version[] };
type Save = "saved" | "dirty" | "saving" | "conflict" | "error";
type Tab = "inspect" | "call" | "tests" | "versions" | "insights";

export default function StudioPage() {
  const status = useSession((s) => s.status);
  const active = useActiveOrg();
  if (status === "loading") return null;
  if (!active) return (
    <>
      <Heading kicker="Agent Studio" title="Design how your receptionist handles every call" />
      <NeedsSignIn what="your agent's conversation flow" />
    </>
  );
  return <Studio orgId={active.organization.id} canEdit={PERMS[active.role].write} />;
}

function Studio({ orgId, canEdit }: { orgId: string; canEdit: boolean }) {
  const agents = useApi<Agent[]>(`/orgs/${orgId}/agents`);
  const [agentId, setAgentId] = useState<string | null>(null);
  useEffect(() => { if (!agentId && agents.data?.length) setAgentId(agents.data[0].id); }, [agents.data, agentId]);
  if (agents.error) return <Notice kind="error">{agents.error.detail}</Notice>;
  if (!agents.data) return <div className="grid h-64 place-items-center text-flw-mute"><Loader2 className="animate-spin" /></div>;
  if (!agents.data.length) return (
    <>
      <Heading kicker="Agent Studio" title="Create your receptionist first" />
      <Glass className="p-6 text-sm text-flw-mute">The Studio edits a receptionist&apos;s conversation flow. <Link href="/flow/app/setup" className="text-flw-cyan hover:underline">Run the setup assistant</Link> to create one — it takes a few minutes.</Glass>
    </>
  );
  return <Editor key={agentId ?? ""} base={`/orgs/${orgId}/agents/${agentId}/flow`} agents={agents.data} agentId={agentId!} onAgent={setAgentId} canEdit={canEdit} />;
}

function Editor({ base, agents, agentId, onAgent, canEdit }: { base: string; agents: Agent[]; agentId: string; onAgent: (id: string) => void; canEdit: boolean }) {
  const [state, setState] = useState<FlowState | null>(null);
  const [hist, setHist] = useState<History | null>(null);
  const [save, setSave] = useState<Save>("saved");
  const [validation, setValidation] = useState<Validation | null>(null);
  const [sel, setSel] = useState<{ id: string; kind: "node" | "edge" } | null>(null);
  const [tab, setTab] = useState<Tab>("inspect");
  const [toast, setToast] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [path, setPath] = useState<{ active: string | null; visited: string[] }>({ active: null, visited: [] });
  const [publishing, setPublishing] = useState<{ note: string; busy: boolean; suite?: Suite; issues?: Issue[] } | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const revision = useRef(0);
  const savedDoc = useRef<FlowDoc | null>(null);
  const latest = useRef<FlowDoc | null>(null);
  const inflight = useRef(false);
  const conflict = useRef(false);

  const load = useCallback(async () => {
    try {
      const s = await api<FlowState>(base);
      setState(s); setHist(history(s.draft)); setValidation(s.validation); setSave("saved");
      revision.current = s.revision; savedDoc.current = s.draft; conflict.current = false; setLoadErr(null);
    } catch (e) { setLoadErr(e instanceof ApiError ? e.detail : "Couldn't load the flow"); }
  }, [base]);
  useEffect(() => { void load(); }, [load]);

  const flow = hist?.present ?? null;
  latest.current = flow;
  const flash = useCallback((kind: "ok" | "error", text: string) => { setToast({ kind, text }); setTimeout(() => setToast(null), 4000); }, []);
  const edit = useCallback((next: FlowDoc) => setHist((h) => (h ? commit(h, next) : h)), []);

  // Autosave: one request at a time, always sending the newest draft with the revision we last saw.
  // A save that finishes while newer edits are waiting sends them straight away, so an edit is
  // never dropped and the badge only says "draft saved" once the newest draft is stored.
  const flush = useCallback(async () => {
    if (inflight.current || conflict.current) return; // the save in flight picks up newer edits when it finishes
    const sending = latest.current;
    if (!sending || sending === savedDoc.current) return;
    inflight.current = true; setSave("saving");
    try {
      const r = await api<{ revision: number; validation: Validation }>(`${base}/draft`, { method: "PUT", body: { graph: sending, base_revision: revision.current } });
      revision.current = r.revision; savedDoc.current = sending; setValidation(r.validation);
      setState((s) => (s ? { ...s, revision: r.revision, draft_differs: true } : s));
    } catch (e) {
      inflight.current = false;
      if (e instanceof ApiError && e.status === 409) { conflict.current = true; setSave("conflict"); }
      else { setSave("error"); flash("error", e instanceof ApiError ? e.detail : "Couldn't save — check your connection"); }
      return;
    }
    inflight.current = false;
    if (latest.current !== savedDoc.current) void flush();
    else setSave("saved");
  }, [base, flash]);

  useEffect(() => {
    if (!flow || !canEdit || flow === savedDoc.current || conflict.current) return;
    setSave("dirty");
    const t = setTimeout(() => void flush(), 900);
    return () => clearTimeout(t);
  }, [flow, canEdit, flush]);

  const node = sel?.kind === "node" ? flow?.nodes.find((n) => n.id === sel.id) ?? null : null;
  const deleteSelected = useCallback(() => {
    if (!flow || !sel || !canEdit) return;
    if (sel.kind === "edge") edit(disconnect(flow, sel.id));
    else {
      if (flow.nodes.find((n) => n.id === sel.id)?.type === "start") { flash("error", "The greeting can't be removed."); return; }
      edit(removeNode(flow, sel.id));
    }
    setSel(null);
  }, [flow, sel, canEdit, edit, flash]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (typing || !canEdit) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); setHist((h) => (h ? (e.shiftKey ? redo(h) : undo(h)) : h)); }
      else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); setHist((h) => (h ? redo(h) : h)); }
      else if ((e.key === "Delete" || e.key === "Backspace") && sel) { e.preventDefault(); deleteSelected(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canEdit, sel, deleteSelected]);

  const add = (type: NodeType, pos?: { x: number; y: number }) => {
    if (!flow || !canEdit) return;
    const p = pos ?? { x: (flow.nodes.at(-1)?.position.x ?? 0) + 40, y: (flow.nodes.at(-1)?.position.y ?? 0) + 140 };
    const r = addNode(flow, type, p);
    edit(r.flow); setSel({ id: r.id, kind: "node" }); setTab("inspect");
  };

  const applyProposal = (p: Proposal) => {
    if (p.base_revision !== revision.current || flow !== savedDoc.current) { flash("error", "The draft changed while that was being prepared. Ask again."); return; }
    edit(p.graph); flash("ok", "Applied to the draft. Undo with ⌘Z, or publish when you're happy.");
  };

  const publish = async () => {
    if (!publishing) return;
    setPublishing({ ...publishing, busy: true, suite: undefined, issues: undefined });
    try {
      const r = await api<{ published_version: number; versions: Version[] }>(`${base}/publish`, { method: "POST", body: { base_revision: revision.current, note: publishing.note } });
      setState((s) => (s ? { ...s, published_version: r.published_version, versions: r.versions, draft_differs: false } : s));
      setPublishing(null); flash("ok", `Published v${r.published_version}. Callers get it from now on.`);
    } catch (e) {
      const d = e instanceof ApiError ? (e.data as { tests?: Suite; validation?: Validation } | undefined) : undefined;
      if (d?.tests) setPublishing((p) => p && { ...p, busy: false, suite: d.tests });
      else if (d?.validation) setPublishing((p) => p && { ...p, busy: false, issues: d.validation!.issues });
      else { setPublishing((p) => p && { ...p, busy: false }); flash("error", e instanceof ApiError ? e.detail : "Couldn't publish"); }
    }
  };

  const issues = validation?.issues ?? [];
  const onPath = useCallback((a: string | null, v: string[]) => setPath({ active: a, visited: v }), []);
  const groups = useMemo(() => {
    const g: Record<string, NodeType[]> = {};
    for (const t of PALETTE) (g[NODE_META[t].group] ??= []).push(t);
    return g;
  }, []);

  if (loadErr) return <Notice kind="error">{loadErr}</Notice>;
  if (!state || !flow || !hist) return <div className="grid h-64 place-items-center text-flw-mute"><Loader2 className="animate-spin" /></div>;
  const canPublish = canEdit && save === "saved" && (validation?.ok ?? false);

  return (
    <div className="space-y-3" data-testid="agent-studio">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Agent" className={clsx(finput, "!w-auto !py-1.5")} value={agentId} onChange={(e) => onAgent(e.target.value)}>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <Chip tone={state.published_version ? "lime" : "mute"}>{state.published_version ? `live v${state.published_version}` : "not published"}</Chip>
        <SaveBadge save={save} />
        {validation && <Chip tone={validation.ok ? "lime" : "pink"}>{validation.ok ? (validation.warnings ? `ready · ${validation.warnings} note(s)` : "ready to publish") : `${validation.errors} to fix`}</Chip>}
        <div className="ml-auto flex items-center gap-1.5">
          <FBtn aria-label="Undo" onClick={() => setHist(undo(hist))} disabled={!canEdit || !hist.past.length}><Undo2 size={14} /></FBtn>
          <FBtn aria-label="Redo" onClick={() => setHist(redo(hist))} disabled={!canEdit || !hist.future.length}><Redo2 size={14} /></FBtn>
          <FBtn variant="glow" disabled={!canPublish} onClick={() => setPublishing({ note: "", busy: false })} title={canPublish ? "Runs every test, then publishes" : "Fix problems and wait for the save first"}><Rocket size={14} /> Publish</FBtn>
        </div>
      </div>
      {save === "conflict" && <Notice kind="error">Someone else changed this flow. <button className="underline" onClick={() => void load()}>Reload their version</button> (your unsaved edits here will be lost).</Notice>}
      {!canEdit && <Notice>You can look and run test calls. Only owners and admins can edit and publish.</Notice>}
      {canEdit && <ChangeByAsking base={base} onApply={applyProposal} disabled={save === "conflict"} />}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[200px_minmax(0,1fr)_400px]">
        {/* Palette */}
        <Glass className="order-2 p-3 xl:order-1">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-flw-mute"><MousePointerClick size={13} /> Drag onto the canvas, or tap to add</div>
          <div className="flex gap-3 overflow-x-auto pb-1 xl:block xl:space-y-3 xl:overflow-visible">
            {Object.entries(groups).map(([group, types]) => (
              <div key={group} className="min-w-[150px] xl:min-w-0">
                <div className="mb-1 font-mono text-[9px] uppercase tracking-widest text-flw-mute/70">{group}</div>
                <div className="space-y-1">
                  {types.map((t) => {
                    const Icon = NODE_ICON[t];
                    return (
                      <button key={t} draggable={canEdit} disabled={!canEdit} onDragStart={(e) => e.dataTransfer.setData("application/voxera-node", t)} onClick={() => add(t)}
                        className="flex w-full items-center gap-2 rounded-lg border border-flw-line/60 px-2 py-1.5 text-left text-xs transition hover:border-flw-violet/60 hover:bg-flw-violet/5 disabled:opacity-50" title={NODE_META[t].blurb} aria-label={`Add ${NODE_META[t].label}`}>
                        <Icon size={13} style={{ color: `rgb(${NODE_META[t].color})` }} />{NODE_META[t].label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Glass>

        {/* Canvas */}
        <div className="order-1 h-[62vh] min-h-[420px] xl:order-2 xl:h-[calc(100vh-210px)]">
          <StudioCanvas flow={flow} selected={sel?.id ?? null} onSelect={(id, kind) => { setSel(id ? { id, kind: kind ?? "node" } : null); if (id && kind !== "edge") setTab("inspect"); }}
            onChange={edit} onAdd={(t, p) => add(t, p)} onError={(m) => flash("error", m)} issues={issues} active={path.active} visited={path.visited} readOnly={!canEdit} />
        </div>

        {/* Right panel */}
        <Glass className="order-3 flex min-h-[420px] flex-col overflow-hidden xl:h-[calc(100vh-210px)]">
          <div className="flex border-b border-flw-line/70" role="tablist">
            {([["inspect", SlidersHorizontal, "Step"], ["call", Phone, "Test call"], ["tests", FlaskConical, "Tests"], ["versions", GitBranch, "Versions"], ["insights", BarChart3, "Insights"]] as const).map(([id, Icon, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={clsx("flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px]", tab === id ? "bg-flw-violet/15 text-flw-text" : "text-flw-mute hover:text-flw-text")}><Icon size={14} />{label}</button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === "inspect" && (node ? (
              <Inspector flow={flow} node={node} issues={issues} readOnly={!canEdit} onChange={(patch) => edit(updateNode(flow, node.id, patch))} onDelete={deleteSelected} onDisconnect={(id) => edit(disconnect(flow, id))} />
            ) : sel?.kind === "edge" ? (
              <div className="space-y-3 p-4 text-sm"><p className="text-flw-mute">Connection selected.</p>{canEdit && <FBtn onClick={deleteSelected}><X size={13} /> Remove connection</FBtn>}</div>
            ) : (
              <div className="space-y-3 p-4">
                <p className="text-sm text-flw-mute">Select a step to edit it. Drag from a coloured dot under a step to connect what happens next. Pink dots aren&apos;t connected yet.</p>
                <IssueList issues={issues} onPick={(id) => { setSel({ id, kind: "node" }); }} />
                <p className="font-mono text-[10px] text-flw-mute">⌘Z undo · ⇧⌘Z redo · Delete removes the selected step</p>
              </div>
            ))}
            {tab === "call" && <TestCall base={base} onPath={onPath} dirty={save !== "saved"} />}
            {tab === "tests" && <TestsPanel base={base} canEdit={canEdit} />}
            {tab === "versions" && <VersionsPanel base={base} versions={state.versions} published={state.published_version} canEdit={canEdit} onChanged={() => void load()} />}
            {tab === "insights" && <InsightsPanel base={base} />}
          </div>
        </Glass>
      </div>

      {publishing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Publish">
          <Glass glow="violet" className="max-h-[85vh] w-full max-w-xl overflow-y-auto p-5">
            <div className="flex items-center gap-2"><Rocket size={16} className="text-flw-violet" /><div className="font-display text-lg">Publish this flow</div><button aria-label="Close" className="ml-auto text-flw-mute" onClick={() => setPublishing(null)}><X size={16} /></button></div>
            <p className="mt-2 text-sm text-flw-mute">Every saved test runs against this draft first. If all pass, it becomes v{(state.versions[0]?.version ?? 0) + 1} and callers get it straight away. You can make an earlier version live again at any time.</p>
            <input aria-label="What changed" className={clsx(finput, "mt-3")} placeholder="What changed? (optional)" maxLength={200} value={publishing.note} onChange={(e) => setPublishing({ ...publishing, note: e.target.value })} />
            {publishing.suite && <div className="mt-4"><Notice kind="error">Not published: some tests failed.</Notice><div className="mt-3"><SuiteResults suite={publishing.suite} /></div></div>}
            {publishing.issues && <div className="mt-4"><Notice kind="error">Not published: the flow has problems.</Notice><IssueList issues={publishing.issues} onPick={(id) => { setPublishing(null); setSel({ id, kind: "node" }); setTab("inspect"); }} /></div>}
            <div className="mt-4 flex gap-2"><FBtn variant="glow" onClick={publish} disabled={publishing.busy}>{publishing.busy ? <><Loader2 size={14} className="animate-spin" /> Running tests…</> : <><Check size={14} /> Run tests and publish</>}</FBtn><FBtn onClick={() => setPublishing(null)}>Cancel</FBtn></div>
          </Glass>
        </div>
      )}
      {toast && <div role={toast.kind === "error" ? "alert" : "status"} className={clsx("fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl border px-4 py-2 text-sm shadow-lg backdrop-blur", toast.kind === "error" ? "border-flw-pink/50 bg-flw-bg/95 text-flw-pink" : "border-flw-lime/50 bg-flw-bg/95 text-flw-lime")}>{toast.text}</div>}
    </div>
  );
}

function SaveBadge({ save }: { save: Save }) {
  const map: Record<Save, [string, "lime" | "amber" | "pink" | "mute", typeof Check]> = {
    saved: ["draft saved", "lime", Check], dirty: ["unsaved", "amber", Loader2], saving: ["saving…", "amber", Loader2],
    conflict: ["edited elsewhere", "pink", AlertTriangle], error: ["not saved", "pink", CloudOff],
  };
  const [label, tone] = map[save];
  return <span data-testid="save-state"><Chip tone={tone}>{label}</Chip></span>;
}

function IssueList({ issues, onPick }: { issues: Issue[]; onPick: (nodeId: string) => void }) {
  if (!issues.length) return <p className="text-sm text-flw-lime">No problems found.</p>;
  return (
    <ul className="space-y-1.5" aria-label="Problems">
      {issues.map((i, k) => (
        <li key={k}>
          <button disabled={!i.node_id} onClick={() => i.node_id && onPick(i.node_id)} className={clsx("w-full rounded-lg border px-2.5 py-1.5 text-left text-xs", i.severity === "error" ? "border-flw-pink/50 bg-flw-pink/10" : "border-flw-amber/50 bg-flw-amber/10")}>{i.message}</button>
        </li>
      ))}
    </ul>
  );
}
