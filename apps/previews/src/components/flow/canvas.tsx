"use client";

import "@xyflow/react/dist/style.css";
import { Background, BackgroundVariant, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { clsx } from "clsx";
import { Bot, Flag, GitFork, Hand, LogOut, MessageSquare, ShieldAlert, Wrench } from "lucide-react";
import { useMemo } from "react";
import { FLOW_EDGES, FLOW_NODES, KIND_COLOR, type FlowKind, type FlowNodeDef } from "@/lib/flow-graph";

const ICON: Record<FlowKind, typeof Bot> = { persona: Bot, entry: Flag, router: GitFork, step: MessageSquare, tool: Wrench, guard: ShieldAlert, handoff: Hand, end: LogOut };

type Look = "dark" | "ivory";
type NData = { def: FlowNodeDef; active: boolean; visited: boolean; selected: boolean; disabled: boolean; look: Look };

// Ivory palette used when the canvas is embedded in Design B (Atelier).
const IVORY_COLOR: Record<FlowKind, string> = {
  persona: "176 104 92", entry: "38 37 35", router: "38 37 35", step: "112 106 97",
  tool: "150 118 70", guard: "184 134 40", handoff: "120 140 112", end: "112 106 97",
};
const LOOK = {
  dark: { node: "bg-[rgb(13_12_22/.92)]", title: "text-[rgb(236_234_255)]", detail: "text-[rgb(150_146_180)]", hot: "103 232 249", cold: "68 62 104", label: "rgb(150 146 180)", labelBg: "rgb(5 5 10)", dots: "rgb(68 62 104)", frame: "border-flw-line/70 bg-flw-bg/60" },
  ivory: { node: "bg-[rgb(255_253_249)] shadow-sm", title: "text-[rgb(38_37_35)]", detail: "text-[rgb(112_106_97)]", hot: "150 118 70", cold: "205 196 180", label: "rgb(112 106 97)", labelBg: "rgb(250 247 241)", dots: "rgb(228 221 208)", frame: "border-atl-line bg-atl-bg/70" },
};

function FlowNode({ data }: NodeProps<Node<NData>>) {
  const { def, active, visited, selected, disabled, look } = data;
  const Icon = ICON[def.kind];
  const c = (look === "ivory" ? IVORY_COLOR : KIND_COLOR)[def.kind];
  const L = LOOK[look];
  return (
    <div
      className={clsx("w-[220px] rounded-2xl border px-3.5 py-3 text-left backdrop-blur transition", L.node, disabled && "opacity-35")}
      style={{
        borderColor: `rgb(${c} / ${active ? 0.95 : selected ? 0.7 : 0.28})`,
        boxShadow: active ? `0 0 0 1px rgb(${c}), 0 0 36px -2px rgb(${c} / .75)` : visited ? `0 0 22px -10px rgb(${c} / .8)` : undefined,
      }}
    >
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-0" style={{ background: `rgb(${c})` }} />
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: `rgb(${c} / .14)`, color: `rgb(${c})` }}><Icon size={14} /></span>
        <div className="min-w-0">
          <div className={clsx("truncate text-[13px] font-medium", L.title)}>{def.label}</div>
          <div className="font-mono text-[9px] uppercase tracking-wider" style={{ color: `rgb(${c} / .8)` }}>{def.kind}{disabled ? " · off" : ""}</div>
        </div>
        {active && <span className="ml-auto h-2 w-2 animate-ping rounded-full" style={{ background: `rgb(${c})` }} />}
      </div>
      <div className={clsx("mt-2 line-clamp-2 text-[11px] leading-snug", L.detail)}>{def.detail}</div>
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-0" style={{ background: `rgb(${c})` }} />
    </div>
  );
}

const nodeTypes = { flow: FlowNode };

export function FlowCanvas({ active, visited = [], selected, onSelect, disabled = [], height = 560, interactive = true, look = "dark" }: { active?: string; visited?: string[]; selected?: string; onSelect?: (id: string) => void; disabled?: string[]; height?: number | string; interactive?: boolean; look?: Look }) {
  const L = LOOK[look];
  const nodes = useMemo<Node<NData>[]>(() => FLOW_NODES.map((def) => ({
    id: def.id, type: "flow", position: { x: def.x, y: def.y },
    data: { def, active: def.id === active, visited: visited.includes(def.id), selected: def.id === selected, disabled: disabled.includes(def.id), look },
  })), [active, visited, selected, disabled, look]);

  const edges = useMemo<Edge[]>(() => FLOW_EDGES.map((e) => {
    const hot = visited.includes(e.from) && (visited.includes(e.to) || e.to === active);
    const c = hot ? L.hot : L.cold;
    return {
      id: `${e.from}-${e.to}`, source: e.from, target: e.to, label: e.label, animated: hot,
      style: { stroke: `rgb(${c})`, strokeWidth: hot ? 2 : 1.2 },
      labelStyle: { fill: L.label, fontSize: 10 },
      labelBgStyle: { fill: L.labelBg, fillOpacity: 0.85 },
      markerEnd: { type: MarkerType.ArrowClosed, color: `rgb(${c})`, width: 14, height: 14 },
    };
  }), [visited, active, L]);

  return (
    <div style={{ height }} className={clsx("w-full overflow-hidden rounded-2xl border", L.frame)}>
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.08 }}
        minZoom={0.2} maxZoom={1.5} proOptions={{ hideAttribution: false }}
        nodesDraggable={interactive} nodesConnectable={false} elementsSelectable={interactive}
        panOnDrag={interactive} zoomOnScroll={interactive}
        onNodeClick={(_, n) => onSelect?.(n.id)}
        colorMode={look === "dark" ? "dark" : "light"}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color={L.dots} />
        {interactive && <Controls showInteractive={false} position="bottom-right" />}
      </ReactFlow>
    </div>
  );
}
