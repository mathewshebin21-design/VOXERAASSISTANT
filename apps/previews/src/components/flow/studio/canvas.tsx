"use client";

import "@xyflow/react/dist/style.css";
import {
  Background, BackgroundVariant, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useReactFlow,
  type Connection, type Edge, type Node, type NodeChange, type NodeProps,
} from "@xyflow/react";
import { clsx } from "clsx";
import {
  Bot, CalendarCheck, CalendarSearch, Clock, GitFork, Hand, HelpCircle, ListChecks, LogOut, MessageSquare, PhoneForwarded, Search, Wrench,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useMemo, useState, type DragEvent } from "react";
import { connect, NODE_META, OUTCOME_LABEL, outcomesOf, type FlowDoc, type NodeType } from "@/lib/studio/graph";

export const NODE_ICON: Record<NodeType, LucideIcon> = {
  start: Bot, ask: HelpCircle, respond: MessageSquare, knowledge: Search, condition: GitFork, hours_check: Clock,
  service_lookup: ListChecks, availability: CalendarSearch, booking: CalendarCheck, collect_info: ListChecks, tool: Wrench,
  escalate: Hand, transfer: PhoneForwarded, end: LogOut,
};

export type Issue = { severity: "error" | "warning"; code: string; message: string; node_id: string | null; edge_id: string | null };
type NData = { flow: FlowDoc; id: string; selected: boolean; active: boolean; visited: boolean; issue: "error" | "warning" | null };

function summary(n: FlowDoc["nodes"][number]): string {
  const s = n.settings as Record<string, unknown>;
  const pick = s.greeting ?? s.question ?? s.message ?? s.reason;
  if (typeof pick === "string" && pick) return pick;
  if (n.type === "condition") return `${((s.rules as unknown[]) ?? []).length} rule(s), else`;
  if (n.type === "availability" && Array.isArray(s.exclude_weekdays) && s.exclude_weekdays.length) return `Not on ${s.exclude_weekdays.length} day(s)`;
  return NODE_META[n.type].blurb;
}

function StudioNode({ data }: NodeProps<Node<NData>>) {
  const n = data.flow.nodes.find((x) => x.id === data.id)!;
  const meta = NODE_META[n.type];
  const outs = outcomesOf(n);
  const used = new Set(data.flow.edges.filter((e) => e.source === n.id).map((e) => e.outcome));
  const Icon = NODE_ICON[n.type];
  const c = meta.color;
  return (
    <div
      className={clsx("relative w-[236px] rounded-2xl border bg-[rgb(13_12_22/.94)] px-3.5 pb-6 pt-3 text-left shadow-[0_8px_30px_-12px_rgb(0_0_0/.8)] backdrop-blur transition-[box-shadow,border-color] duration-200")}
      style={{
        borderColor: `rgb(${data.issue === "error" ? "244 114 182" : c} / ${data.selected || data.active ? 0.95 : data.issue ? 0.8 : 0.3})`,
        boxShadow: data.active ? `0 0 0 1px rgb(${c}), 0 0 36px -4px rgb(${c} / .7)` : data.visited ? `0 0 22px -10px rgb(${c} / .9)` : undefined,
      }}
      data-testid={`node-${n.id}`}
    >
      {n.type !== "start" && <Handle type="target" position={Position.Top} className="!h-2.5 !w-2.5 !border-0" style={{ background: `rgb(${c})` }} />}
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg" style={{ background: `rgb(${c} / .14)`, color: `rgb(${c})` }}><Icon size={14} /></span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-flw-text">{n.label || meta.label}</div>
          <div className="font-mono text-[9px] uppercase tracking-wider" style={{ color: `rgb(${c} / .85)` }}>{meta.label}</div>
        </div>
        {data.issue && <span title={data.issue === "error" ? "Needs fixing before publishing" : "Worth checking"} className={clsx("h-2 w-2 rounded-full", data.issue === "error" ? "bg-flw-pink" : "bg-flw-amber")} />}
        {data.active && <span className="h-2 w-2 animate-ping rounded-full" style={{ background: `rgb(${c})` }} />}
      </div>
      <div className="mt-2 line-clamp-2 text-[11px] leading-snug text-flw-mute">{summary(n)}</div>
      {outs.map((o, i) => {
        const left = `${((i + 1) / (outs.length + 1)) * 100}%`;
        return (
          <div key={o}>
            <Handle id={o} type="source" position={Position.Bottom} className="!h-2.5 !w-2.5 !border-0" style={{ left, background: used.has(o) ? `rgb(${c})` : "rgb(244 114 182)" }} />
            <span className="pointer-events-none absolute bottom-1 -translate-x-1/2 whitespace-nowrap font-mono text-[8.5px] text-flw-mute" style={{ left }}>{OUTCOME_LABEL[o] ?? o}</span>
          </div>
        );
      })}
    </div>
  );
}

const nodeTypes = { studio: StudioNode };

export interface CanvasProps {
  flow: FlowDoc;
  selected: string | null;
  onSelect: (id: string | null, kind?: "node" | "edge") => void;
  onChange: (flow: FlowDoc) => void;
  onAdd: (type: NodeType, pos: { x: number; y: number }) => void;
  onError: (msg: string) => void;
  issues: Issue[];
  active?: string | null;
  visited?: string[];
  readOnly?: boolean;
}

function Inner({ flow, selected, onSelect, onChange, onAdd, onError, issues, active, visited = [], readOnly }: CanvasProps) {
  const rf = useReactFlow();
  const [drag, setDrag] = useState<Record<string, { x: number; y: number }>>({});
  const worst = useMemo(() => {
    const m: Record<string, "error" | "warning"> = {};
    for (const i of issues) if (i.node_id && m[i.node_id] !== "error") m[i.node_id] = i.severity;
    return m;
  }, [issues]);

  const nodes = useMemo<Node<NData>[]>(() => flow.nodes.map((n) => ({
    id: n.id, type: "studio", position: drag[n.id] ?? n.position, deletable: !readOnly && n.type !== "start",
    data: { flow, id: n.id, selected: n.id === selected, active: n.id === active, visited: visited.includes(n.id), issue: worst[n.id] ?? null },
    selected: n.id === selected,
  })), [flow, drag, selected, active, visited, worst, readOnly]);

  const edges = useMemo<Edge[]>(() => flow.edges.map((e) => {
    const hot = visited.includes(e.source) && (visited.includes(e.target) || e.target === active);
    const sel = e.id === selected;
    const stroke = sel ? "rgb(103 232 249)" : hot ? "rgb(167 139 250)" : "rgb(68 62 104)";
    return {
      id: e.id, source: e.source, sourceHandle: e.outcome, target: e.target, animated: hot, selected: sel,
      label: OUTCOME_LABEL[e.outcome] ?? e.outcome, deletable: !readOnly,
      style: { stroke, strokeWidth: sel || hot ? 2.2 : 1.3 },
      labelStyle: { fill: "rgb(150 146 180)", fontSize: 10 }, labelBgStyle: { fill: "rgb(5 5 10)", fillOpacity: 0.85 },
      markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 14, height: 14 },
    };
  }), [flow.edges, visited, active, selected, readOnly]);

  const onNodesChange = useCallback((changes: NodeChange<Node<NData>>[]) => {
    for (const c of changes) {
      if (c.type === "position" && c.position) setDrag((d) => ({ ...d, [c.id]: c.position! }));
    }
  }, []);

  const onNodeDragStop = useCallback((_: unknown, node: Node) => {
    setDrag((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== node.id)));
    onChange({ ...flow, nodes: flow.nodes.map((n) => (n.id === node.id ? { ...n, position: { x: Math.round(node.position.x), y: Math.round(node.position.y) } } : n)) });
  }, [flow, onChange]);

  const onConnect = useCallback((c: Connection) => {
    if (readOnly || !c.source || !c.target || !c.sourceHandle) return;
    const r = connect(flow, c.source, c.sourceHandle, c.target);
    if (r.ok) onChange(r.flow); else onError(r.reason);
  }, [flow, onChange, onError, readOnly]);

  const onDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData("application/voxera-node") as NodeType;
    if (!type || readOnly) return;
    onAdd(type, rf.screenToFlowPosition({ x: e.clientX - 118, y: e.clientY - 30 }));
  }, [rf, onAdd, readOnly]);

  return (
    <ReactFlow
      nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.12 }} minZoom={0.15} maxZoom={1.6}
      onNodesChange={onNodesChange} onNodeDragStop={onNodeDragStop} onConnect={onConnect}
      onNodeClick={(_, n) => onSelect(n.id, "node")} onEdgeClick={(_, e) => onSelect(e.id, "edge")} onPaneClick={() => onSelect(null)}
      deleteKeyCode={null} nodesDraggable={!readOnly} nodesConnectable={!readOnly}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }} onDrop={onDrop}
      proOptions={{ hideAttribution: false }} className="studio-canvas"
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgb(68 62 104)" />
      <Controls showInteractive={false} className="!rounded-xl !border !border-flw-line !bg-flw-bg/80" />
    </ReactFlow>
  );
}

export function StudioCanvas(p: CanvasProps) {
  return (
    <div className="h-full w-full overflow-hidden rounded-2xl border border-flw-line/70 bg-flw-bg/60" data-testid="studio-canvas">
      <ReactFlowProvider><Inner {...p} /></ReactFlowProvider>
    </div>
  );
}
