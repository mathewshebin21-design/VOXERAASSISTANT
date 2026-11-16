"use client";

import { clsx } from "clsx";
import { Plus, Trash2, Unlink } from "lucide-react";
import { Chip, FBtn, finput, FSwitch } from "@/components/flow/ui";
import { NODE_META, OUTCOME_LABEL, outcomesOf, type Field, type FlowDoc, type FlowNode, type Rule } from "@/lib/studio/graph";
import { NODE_ICON, type Issue } from "./canvas";

const OPS = [
  { value: "equals", label: "is" }, { value: "not_equals", label: "is not" }, { value: "contains", label: "contains" },
  { value: "in", label: "is one of (a,b)" }, { value: "is_set", label: "is known" }, { value: "is_not_set", label: "is unknown" },
  { value: "is_yes", label: "means yes" }, { value: "is_no", label: "means no" },
  { value: "time_after", label: "time is after (HH:MM)" }, { value: "time_before", label: "time is before (HH:MM)" },
];
const VARS = ["intent", "last_message", "service", "now_local", "customer_name", "caller_phone"];

function RulesEditor({ rules, onChange }: { rules: Rule[]; onChange: (r: Rule[]) => void }) {
  const set = (i: number, patch: Partial<Rule>) => onChange(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2">
      {rules.map((r, i) => (
        <div key={i} className="rounded-xl border border-flw-line/70 p-2.5">
          <div className="flex items-center gap-2">
            <input aria-label={`Rule ${i + 1} name`} className={clsx(finput, "!py-1.5 font-mono text-xs")} value={r.id} onChange={(e) => set(i, { id: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") })} />
            <button aria-label={`Remove rule ${i + 1}`} onClick={() => onChange(rules.filter((_, j) => j !== i))} className="text-flw-mute hover:text-flw-pink"><Trash2 size={14} /></button>
          </div>
          <div className="mt-2 grid grid-cols-[1fr_1fr] gap-2">
            <input aria-label={`Rule ${i + 1} variable`} list="studio-vars" className={clsx(finput, "!py-1.5 text-xs")} value={r.variable} onChange={(e) => set(i, { variable: e.target.value })} />
            <select aria-label={`Rule ${i + 1} test`} className={clsx(finput, "!py-1.5 text-xs")} value={r.op} onChange={(e) => set(i, { op: e.target.value })}>{OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
          </div>
          {!["is_set", "is_not_set", "is_yes", "is_no"].includes(r.op) && <input aria-label={`Rule ${i + 1} value`} className={clsx(finput, "mt-2 !py-1.5 text-xs")} placeholder="value" value={r.value} onChange={(e) => set(i, { value: e.target.value })} />}
          <input aria-label={`Rule ${i + 1} label`} className={clsx(finput, "mt-2 !py-1.5 text-xs")} placeholder="Label shown on the canvas" value={r.label} onChange={(e) => set(i, { label: e.target.value })} />
        </div>
      ))}
      <datalist id="studio-vars">{VARS.map((v) => <option key={v} value={v} />)}</datalist>
      <FBtn onClick={() => onChange([...rules, { id: `rule${rules.length + 1}`, variable: "intent", op: "equals", value: "", label: "" }])} disabled={rules.length >= 12}><Plus size={13} /> Add rule</FBtn>
    </div>
  );
}

function FieldInput({ f, value, onChange }: { f: Field; value: unknown; onChange: (v: unknown) => void }) {
  switch (f.kind) {
    case "text": return <input aria-label={f.label} className={finput} value={String(value ?? "")} maxLength={f.max} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
    case "textarea": return <textarea aria-label={f.label} className={clsx(finput, "min-h-[84px] resize-y")} value={String(value ?? "")} maxLength={f.max} onChange={(e) => onChange(e.target.value)} />;
    case "number": return <input aria-label={f.label} type="number" min={f.min} max={f.max} className={finput} value={Number(value ?? f.min)} onChange={(e) => onChange(Math.max(f.min, Math.min(f.max, Number(e.target.value) || f.min)))} />;
    case "select": return <select aria-label={f.label} className={finput} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>{f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
    case "toggle": return <FSwitch label={f.label} on={Boolean(value)} onChange={onChange} />;
    case "checks": {
      const arr = (Array.isArray(value) ? value : []).map(String);
      const numeric = f.options.every((o) => /^\d+$/.test(o.value));
      return (
        <div className="flex flex-wrap gap-1.5">
          {f.options.map((o) => {
            const on = arr.includes(o.value);
            const next = on ? arr.filter((x) => x !== o.value) : [...arr, o.value];
            return <button key={o.value} type="button" aria-pressed={on} onClick={() => onChange(numeric ? next.map(Number) : next)} className={clsx("rounded-lg border px-2 py-1 text-xs", on ? "border-flw-cyan/70 bg-flw-cyan/10 text-flw-text" : "border-flw-line text-flw-mute hover:text-flw-text")}>{o.label}</button>;
          })}
        </div>
      );
    }
    case "rules": return <RulesEditor rules={(value as Rule[]) ?? []} onChange={onChange} />;
  }
}

export function Inspector({ flow, node, issues, onChange, onDelete, onDisconnect, readOnly }: {
  flow: FlowDoc; node: FlowNode; issues: Issue[]; onChange: (patch: Partial<FlowNode>) => void; onDelete: () => void;
  onDisconnect: (edgeId: string) => void; readOnly: boolean;
}) {
  const meta = NODE_META[node.type];
  const Icon = NODE_ICON[node.type];
  const mine = issues.filter((i) => i.node_id === node.id);
  const outgoing = flow.edges.filter((e) => e.source === node.id);
  const name = (id: string) => flow.nodes.find((n) => n.id === id)?.label || id;
  return (
    <div className="space-y-4 p-4" data-testid="inspector">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: `rgb(${meta.color} / .14)`, color: `rgb(${meta.color})` }}><Icon size={16} /></span>
        <div className="min-w-0 flex-1">
          <input aria-label="Step name" disabled={readOnly} className={clsx(finput, "!py-1.5 font-medium")} value={node.label} maxLength={120} onChange={(e) => onChange({ label: e.target.value })} />
          <p className="mt-1 text-xs text-flw-mute">{meta.blurb}</p>
        </div>
      </div>
      {mine.length > 0 && (
        <ul className="space-y-1.5" aria-label="Problems with this step">
          {mine.map((i, k) => <li key={k} className={clsx("rounded-lg border px-2.5 py-1.5 text-xs", i.severity === "error" ? "border-flw-pink/50 bg-flw-pink/10 text-flw-text" : "border-flw-amber/50 bg-flw-amber/10 text-flw-text")}>{i.message}</li>)}
        </ul>
      )}
      <fieldset disabled={readOnly} className="space-y-3">
        {meta.fields.map((f) => (
          <label key={f.key} className="block space-y-1.5">
            {f.kind !== "toggle" && <span className="text-xs font-medium text-flw-mute">{f.label}</span>}
            <FieldInput f={f} value={node.settings[f.key]} onChange={(v) => onChange({ settings: { ...node.settings, [f.key]: v } })} />
            {f.help && <span className="block text-[11px] text-flw-mute/80">{f.help}</span>}
          </label>
        ))}
        {node.type === "booking" && <p className="rounded-lg border border-flw-lime/30 bg-flw-lime/5 p-2.5 text-xs text-flw-mute">Always reads the service, time and name back, and books only after a clear yes. Bookings are checked against your diary when they&apos;re made.</p>}
      </fieldset>
      <div>
        <div className="mb-1.5 text-xs font-medium text-flw-mute">Where each outcome goes</div>
        <ul className="space-y-1">
          {outcomesOf(node).map((o) => {
            const e = outgoing.find((x) => x.outcome === o);
            return (
              <li key={o} className="flex items-center justify-between gap-2 rounded-lg border border-flw-line/60 px-2.5 py-1.5 text-xs">
                <span className="font-mono text-flw-mute">{OUTCOME_LABEL[o] ?? o}</span>
                {e ? <span className="flex min-w-0 items-center gap-2"><span className="truncate">{name(e.target)}</span>{!readOnly && <button aria-label={`Disconnect ${o}`} onClick={() => onDisconnect(e.id)} className="text-flw-mute hover:text-flw-pink"><Unlink size={12} /></button>}</span>
                  : <Chip tone="pink">drag from the {OUTCOME_LABEL[o] ?? o} dot</Chip>}
              </li>
            );
          })}
          {outcomesOf(node).length === 0 && <li className="text-xs text-flw-mute">This step ends the call.</li>}
        </ul>
      </div>
      {node.type !== "start" && !readOnly && <FBtn onClick={onDelete} className="w-full justify-center border-flw-pink/40 text-flw-pink hover:bg-flw-pink/10"><Trash2 size={14} /> Delete step</FBtn>}
    </div>
  );
}
