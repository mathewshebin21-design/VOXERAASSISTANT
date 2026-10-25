"use client";

import { clsx } from "clsx";
import { motion } from "framer-motion";
import { FileText, Globe, PenLine, Plus, ShieldX } from "lucide-react";
import { useMemo, useState } from "react";
import { Chip, FBtn, finput, Glass, GHead, Heading } from "@/components/flow/ui";
import { detectConflicts, retrieve, scanInjection } from "@/lib/knowledge";
import { usePreview } from "@/lib/store";
import { DEMO_TODAY } from "@/lib/time";
import type { KnowledgeEntry } from "@/lib/types";

const srcIcon = (s: string) => (/website/i.test(s) ? Globe : /pdf|handbook/i.test(s) ? FileText : PenLine);

export default function Knowledge() {
  const { knowledge, upsertKnowledge, removeKnowledge } = usePreview();
  const [selId, setSelId] = useState(knowledge[0]?.id);
  const [edit, setEdit] = useState<KnowledgeEntry | null>(null);
  const [q, setQ] = useState("how much is a blow dry");
  const sel = edit ?? knowledge.find((k) => k.id === selId);
  const hits = useMemo(() => retrieve(q, knowledge, 4), [q, knowledge]);
  const conflicts = useMemo(() => detectConflicts(knowledge), [knowledge]);
  const flags = sel ? scanInjection(sel.body) : [];
  const sources = useMemo(() => [...new Set(knowledge.map((k) => k.source.split(" ·")[0].split(" (")[0]))], [knowledge]);

  return (
    <>
      <Heading kicker="Knowledge graph" title="Grounding sources">
        <FBtn onClick={() => { const e: KnowledgeEntry = { id: `kb-${Date.now().toString(36)}`, category: "FAQ", title: "New fact", body: "", source: "Owner-written", updatedAt: DEMO_TODAY, version: 1, status: "needs_review" }; setEdit(e); setSelId(e.id); }}><Plus size={14} /> Add fact</FBtn>
      </Heading>
      <div className="mb-4 flex flex-wrap gap-2">
        {sources.map((s) => { const I = srcIcon(s); return <span key={s} className="inline-flex items-center gap-1.5 rounded-xl border border-flw-line bg-flw-surface/60 px-3 py-1.5 text-xs"><I size={13} className="text-flw-cyan" />{s} <span className="text-flw-mute">· {knowledge.filter((k) => k.source.startsWith(s)).length}</span></span>; })}
      </div>
      {conflicts.map((c) => <div key={c.topic} className="mb-4 rounded-2xl border border-flw-amber/40 bg-flw-amber/5 px-4 py-3 text-sm text-flw-amber">Conflict · “{c.topic}”: {c.amounts.join(" vs ")} across {c.ids.join(", ")}. The agent defers to staff until resolved.</div>)}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr]">
        <Glass>
          <GHead title={`${knowledge.length} facts`} />
          <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2">
            {knowledge.map((k) => {
              const I = srcIcon(k.source);
              return (
                <button key={k.id} onClick={() => { setSelId(k.id); setEdit(null); }} className={clsx("rounded-xl border p-3 text-left transition", selId === k.id ? "border-flw-violet bg-flw-violet/10" : "border-flw-line bg-flw-surface/50 hover:border-flw-violet/50")}>
                  <div className="flex items-center gap-2"><I size={13} className="shrink-0 text-flw-mute" /><span className="truncate text-sm font-medium">{k.title}</span></div>
                  <div className="mt-2 flex items-center justify-between"><span className="font-mono text-[10px] text-flw-mute">{k.category} · v{k.version}</span><Chip tone={k.status === "verified" ? "lime" : k.status === "conflict" ? "amber" : "mute"}>{k.status.replace("_", " ")}</Chip></div>
                </button>
              );
            })}
          </div>
        </Glass>
        <div className="space-y-4">
          {sel && (
            <Glass glow="violet">
              <GHead title="Fact editor" right={<span className="font-mono text-[10px] text-flw-mute">{sel.source}</span>} />
              <div className="space-y-3 p-4">
                <input aria-label="Title" className={finput} value={sel.title} onChange={(e) => setEdit({ ...sel, title: e.target.value })} />
                <textarea aria-label="Content" rows={5} className={finput} value={sel.body} onChange={(e) => setEdit({ ...sel, body: e.target.value })} />
                {sel.conflictNote && <p className="text-xs text-flw-amber">{sel.conflictNote}</p>}
                {flags.length > 0 && <p className="flex gap-2 text-xs text-flw-pink"><ShieldX size={14} />Instruction-like text (“{flags[0]}”) — quarantined.</p>}
                <div className="flex flex-wrap gap-2">
                  <FBtn variant="glow" disabled={!edit} onClick={() => { if (!edit) return; upsertKnowledge({ ...edit, version: knowledge.some((k) => k.id === edit.id) ? edit.version + 1 : 1, updatedAt: DEMO_TODAY }); setEdit(null); }}>Save version</FBtn>
                  <FBtn disabled={sel.status === "verified" || flags.length > 0} onClick={() => { upsertKnowledge({ ...sel, status: "verified", conflictNote: undefined }); setEdit(null); }}>Verify</FBtn>
                  <FBtn onClick={() => { removeKnowledge(sel.id); setEdit(null); setSelId(knowledge[0]?.id); }}>Remove</FBtn>
                </div>
              </div>
            </Glass>
          )}
          <Glass glow="cyan">
            <GHead title="Retrieval probe" right={<Chip tone="cyan">lexical · preview</Chip>} />
            <div className="p-4">
              <input aria-label="Probe question" className={finput} value={q} onChange={(e) => setQ(e.target.value)} />
              <ul className="mt-4 space-y-3">
                {hits.length ? hits.map((h) => (
                  <li key={h.entry.id}>
                    <div className="flex items-center justify-between text-sm"><span>{h.entry.title}</span><span className="font-mono text-xs text-flw-cyan">{h.score.toFixed(2)}</span></div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-flw-line/60"><motion.div className="h-full rounded-full bg-gradient-to-r from-flw-violet to-flw-cyan" initial={{ width: 0 }} animate={{ width: `${h.score * 100}%` }} /></div>
                    <div className="mt-1 font-mono text-[10px] text-flw-mute">tokens: {h.matched.join(" · ")} {h.entry.status !== "verified" && "· not spoken (unverified)"}</div>
                  </li>
                )) : <li className="text-sm text-flw-mute">No grounding found → “I don&apos;t know” + message offer.</li>}
              </ul>
            </div>
          </Glass>
        </div>
      </div>
    </>
  );
}
