"use client";

import "@xyflow/react/dist/style.css";
import { Background, BackgroundVariant, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { clsx } from "clsx";
import { Bot, Flag, GitFork, Hand, LogOut, MessageSquare, ShieldAlert, Wrench } from "lucide-react";
import { useMemo } from "react";
import { FLOW_EDGES, FLOW_NODES, KIND_COLOR, type FlowKind, type FlowNodeDef } from "@/lib/flow-graph";

const ICON: Record<FlowKind, typeof Bot> = { persona: Bot, entry: Flag, router: GitFork, step: MessageSquare, tool: Wrench, guard: ShieldAlert, handoff: Hand, end: LogOut };

type NData = { def: FlowNodeDef; active: boolean; visited: boolean; selected: boolean; disabled: boolean };

function FlowNode({ data }: NodeProps<Node<NData>>) {
  const { def, active, visited, selected, disabled } = data;
  const Icon = ICON[def.kind];
  const c = KIND_COLOR[def.kind];
  return (
    <div
      className={clsx("w-[220px] rounded-2xl border bg-[rgb(13_12_22/.92)] px-3.5 py-3 text-left backdrop-blur transition", disabled && "opacity-35")}
      style={{
        borderColor: `rgb(${c} / ${active ? 0.95 : selected ? 0.7 : 0.28})`,
        boxShadow: active ? `0 0 0 1px rgb(${c}), 0 0 36px -2px rgb(${c} / .75)` : visited ? `0 0 22px -10px rgb(${c} / .8)` : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0" style={{ background: `rgb(${c})` }} />
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: `rgb(${c} / .14)`, color: `rgb(${c})` }}><Icon size={14} /></span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-[rgb(236_234_255)]">{def.label}</div>
          <div className="font-mono text-[9px] uppercase tracking-wider" style={{ color: `rgb(${c} / .8)` }}>{def.kind}{disabled ? " · off" : ""}</div>
        </div>
        {active && <span className="ml-auto h-2 w-2 animate-ping rounded-full" style={{ background: `rgb(${c})` }} />}
      </div>
      <div className="mt-2 line-clamp-2 text-[11px] leading-snug text-[rgb(150_146_180)]">{def.detail}</div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0" style={{ background: `rgb(${c})` }} />
    </div>
  );
}

const nodeTypes = { flow: FlowNode };

export function FlowCanvas({ active, visited = [], selected, onSelect, disabled = [], height = 560, interactive = true }: { active?: string; visited?: string[]; selected?: string; onSelect?: (id: string) => void; disabled?: string[]; height?: number | string; interactive?: boolean }) {
  const nodes = useMemo<Node<NData>[]>(() => FLOW_NODES.map((def) => ({
    id: def.id, type: "flow", position: { x: def.x, y: def.y },
    data: { def, active: def.id === active, visited: visited.includes(def.id), selected: def.id === selected, disabled: disabled.includes(def.id) },
  })), [active, visited, selected, disabled]);

  const edges = useMemo<Edge[]>(() => FLOW_EDGES.map((e) => {
    const hot = visited.includes(e.from) && (visited.includes(e.to) || e.to === active);
    const c = hot ? "103 232 249" : "68 62 104";
    return {
      id: `${e.from}-${e.to}`, source: e.from, target: e.to, label: e.label, animated: hot,
      style: { stroke: `rgb(${c})`, strokeWidth: hot ? 2 : 1.2 },
      labelStyle: { fill: "rgb(150 146 180)", fontSize: 10 },
      labelBgStyle: { fill: "rgb(5 5 10)", fillOpacity: 0.85 },
      markerEnd: { type: MarkerType.ArrowClosed, color: `rgb(${c})`, width: 14, height: 14 },
    };
  }), [visited, active]);

  return (
    <div style={{ height }} className="w-full overflow-hidden rounded-2xl border border-flw-line/70 bg-flw-bg/60">
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.15 }}
        minZoom={0.2} maxZoom={1.5} proOptions={{ hideAttribution: false }}
        nodesDraggable={interactive} nodesConnectable={false} elementsSelectable={interactive}
        panOnDrag={interactive} zoomOnScroll={interactive}
        onNodeClick={(_, n) => onSelect?.(n.id)}
        colorMode="dark"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="rgb(68 62 104)" />
        {interactive && <Controls showInteractive={false} position="bottom-right" />}
      </ReactFlow>
    </div>
  );
}
