"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { BaseEdge, EdgeLabelRenderer, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type EdgeProps, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { DiagramBlock } from "@/lib/dsl/schema";
import { chooseDiagramLayout, diagramGeometryKey, diagramViewport, layoutDiagramCandidates, type DiagramCandidates, type DiagramDirection, type DiagramLayout, type DiagramPort } from "@/lib/dsl/diagram-layout";

type LessonNode = Node<{ label: string; accessibleLabel: string; ports: DiagramPort[]; active: boolean; choose: () => void }, "lesson">;
type LessonEdge = Edge<{ path: string; labelPosition?: { x: number; y: number }; labelWidth?: number; labelHeight?: number }, "lesson">;

function DiagramNode({ data }: NodeProps<LessonNode>) {
  return <>
    {data.ports.map(port => <Handle key={port.id} id={port.id} type={port.type} position={port.side === "NORTH" ? Position.Top : port.side === "SOUTH" ? Position.Bottom : port.side === "WEST" ? Position.Left : Position.Right} className="!opacity-0" style={{ left: port.x, top: port.y, right: "auto", bottom: "auto" }} />)}
    <button type="button" onClick={data.choose} aria-label={data.accessibleLabel} aria-pressed={data.active} className={`nodrag nopan h-full w-full whitespace-pre-wrap rounded-xl border px-3 py-2 text-left text-sm font-medium leading-[22px] [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 ${data.active ? "border-accent-500 bg-accent-50 text-accent-700 shadow-sm" : "border-secondary-200 bg-card text-stone-800 hover:border-secondary-500"}`}>{data.label}</button>
  </>;
}

function DiagramGroup({ data }: NodeProps<Node<{ label: string; labelPosition?: { x: number; y: number } }>>) {
  return <span className="absolute whitespace-pre-wrap font-medium leading-5" style={{ left: data.labelPosition?.x ?? 14, top: data.labelPosition?.y ?? 14 }}>{data.label}</span>;
}

function DiagramEdge({ id, data, markerEnd, style, label }: EdgeProps<LessonEdge>) {
  return <>
    <BaseEdge id={id} path={data!.path} markerEnd={markerEnd} style={style} />
    {label && data?.labelPosition && <EdgeLabelRenderer><span className="diagram-edge-label pointer-events-none absolute z-[2] whitespace-pre-wrap rounded bg-card/95 px-1 py-0.5 text-xs leading-4 text-stone-600" style={{ width: data.labelWidth, height: data.labelHeight, transform: `translate(${data.labelPosition.x}px, ${data.labelPosition.y}px)` }}>{label}</span></EdgeLabelRenderer>}
  </>;
}

const nodeTypes = { lesson: DiagramNode, lessonGroup: DiagramGroup };
const edgeTypes = { lesson: DiagramEdge };
const fitOptions = { padding: 0.1, minZoom: 0.15, maxZoom: 1 };

function stepFitOptions(block: DiagramBlock, index: number) {
  const ids = block.steps![index].nodeIds;
  const groups = new Set(ids.map(id => block.nodes.find(node => node.id === id)!.group));
  const group = groups.size === 1 ? [...groups][0] : undefined;
  return { nodes: [...ids.map(id => ({ id: `node:${id}` })), ...(group ? [{ id: `group:${group}` }] : [])], padding: 0.1, minZoom: 0.5, maxZoom: 1 };
}

function DiagramCanvas({ block }: { block: DiagramBlock }) {
  const id = useId();
  const [candidates, setCandidates] = useState<DiagramCandidates | null>(null);
  const [orientation, setOrientation] = useState<"auto" | DiagramDirection>("auto");
  const [width, setWidth] = useState(800);
  const [measuredHeight, setMeasuredHeight] = useState(560);
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [step, setStep] = useState<number | null>(() => typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches && block.steps?.length ? 0 : null);
  const flow = useReactFlow();
  useEffect(() => {
    let cancelled = false;
    layoutDiagramCandidates(block).then(value => { if (!cancelled) { setCandidates(value); setError(false); } }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [block, retry]);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => {
      setWidth(Math.round(entries[0].contentRect.width));
      setMeasuredHeight(Math.round(entries[0].contentRect.height));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const layout: DiagramLayout | null = candidates ? orientation === "auto" ? chooseDiagramLayout(candidates, width, block.direction) : candidates[orientation] : null;
  const height = layout ? diagramViewport(layout, width).height : 560;
  useEffect(() => {
    // 方向切换会改变图框高度，等实际尺寸与 React Flow 的观察器同步后再适配。
    if (!layout || measuredHeight !== height) return;
    const frame = requestAnimationFrame(() => { void flow.fitBounds(layout.bounds, { padding: 0.06 }); });
    return () => cancelAnimationFrame(frame);
  }, [layout, width, height, measuredHeight, flow]);
  const currentStep = step === null ? undefined : block.steps?.[step];
  const activeNodes = currentStep?.nodeIds ?? (selected ? [selected] : []);
  const activeEdges = currentStep?.edgeIds ?? [];
  const selectedNode = block.nodes.find(node => node.id === selected);
  const nodes: Node[] = (layout?.nodes ?? []).map(node => node.group ? {
    id: node.id, type: "lessonGroup", position: node.position, data: { label: node.label, labelPosition: node.labelPosition },
    style: { width: node.width, height: node.height, background: "var(--color-secondary-50)", border: "1px solid var(--color-secondary-200)", borderRadius: 16, color: "var(--color-secondary-700)", padding: 14, fontSize: 13 },
    selectable: false, draggable: false, focusable: false,
  } : {
    id: node.id, type: "lesson", position: node.position, parentId: node.parentId,
    style: { width: node.width, height: node.height, pointerEvents: "all" }, draggable: false, selectable: false, focusable: false,
    data: { label: node.label, accessibleLabel: block.nodes.find(item => `node:${item.id}` === node.id)!.label, ports: node.ports, active: activeNodes.includes(node.id.slice(5)), choose: () => { setSelected(node.id.slice(5)); setStep(null); } },
  });
  const edges: Edge[] = (layout?.edges ?? []).map(edge => {
    const source = block.edges.find(item => item.id === edge.id)!;
    const active = activeEdges.includes(edge.id) || (selected !== null && (source.source === selected || source.target === selected));
    const color = active ? "var(--color-accent-600)" : "var(--color-secondary-400)";
    return { id: source.id, type: "lesson", source: `node:${source.source}`, target: `node:${source.target}`, sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle, label: edge.label,
      data: { path: edge.path, labelPosition: edge.labelPosition, labelWidth: edge.labelWidth, labelHeight: edge.labelHeight }, focusable: false, selectable: false,
      markerEnd: { type: MarkerType.ArrowClosed, color }, style: { stroke: color, strokeWidth: active ? 2.5 : 1.5, strokeDasharray: source.kind === "residual" ? "6 4" : undefined },
    };
  });
  const steps = block.steps ?? [];
  const chooseStep = (index: number | null) => {
    setStep(index); setSelected(null);
    if (index === null && layout) void flow.fitBounds(layout.bounds, { padding: 0.06 });
    else if (index !== null) void flow.fitView(stepFitOptions(block, index));
  };
  const nodeList = useMemo(() => block.nodes.map(node => <button key={node.id} type="button" aria-pressed={selected === node.id} onClick={() => { setSelected(node.id); setStep(null); void flow.fitView({ nodes: [{ id: `node:${node.id}` }], padding: 0.8, maxZoom: 1 }); }} className={`min-h-9 rounded-lg border px-2 py-1 text-xs ${selected === node.id ? "border-accent-300 bg-accent-50 text-accent-700" : "border-stone-200 bg-card text-stone-700"}`}>{node.label}</button>), [block.nodes, flow, selected]);

  return <figure aria-label={block.title} className="min-w-0 overflow-hidden rounded-2xl border border-stone-200 bg-paper/50">
    <figcaption className="border-b border-stone-200 px-4 py-3">
      <h3 className="font-display text-base font-semibold text-stone-900">{block.title}</h3>
      <p className="mt-1 text-xs leading-5 text-stone-600">{block.caption ?? "点击模块查看说明，按步骤探索数据流。"}</p>
      <p className="mt-1 text-xs leading-5 text-stone-500 sm:hidden">窄屏可按步骤聚焦阅读，也可用下方模块导航定位。</p>
    </figcaption>
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-3 py-2">
      <p className="text-xs text-stone-500">实线：数据流{block.edges.some(edge => edge.kind === "residual") ? " · 虚线：残差 / 跳连" : ""}</p>
      <div className="flex gap-1">
        <div role="group" aria-label="架构图排布方向" className="mr-2 flex rounded-lg border border-stone-200 bg-card p-0.5">
          {([['auto', '自动'], ['LR', '横向'], ['TB', '纵向']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={orientation === value} onClick={() => { setOrientation(value); setStep(null); setSelected(null); }} className={`min-h-8 rounded-md px-2 text-xs ${orientation === value ? "bg-secondary-50 font-medium text-secondary-700" : "text-stone-600 hover:bg-stone-50"}`}>{label}</button>)}
        </div>
        <button type="button" onClick={() => void flow.zoomIn()} aria-label="放大架构图" className="h-9 w-9 rounded-lg border border-stone-200 bg-card text-stone-700">＋</button>
        <button type="button" onClick={() => void flow.zoomOut()} aria-label="缩小架构图" className="h-9 w-9 rounded-lg border border-stone-200 bg-card text-stone-700">−</button>
        <button type="button" onClick={() => chooseStep(null)} className="min-h-9 rounded-lg border border-stone-200 bg-card px-2 text-xs text-stone-700">适应视图</button>
      </div>
    </div>
    <div ref={container} className="diagram-canvas relative w-full" style={{ height }} data-direction={layout?.direction} aria-busy={!layout && !error}>
      {layout && <ReactFlow id={id} key={retry} nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView fitViewOptions={step === null ? fitOptions : stepFitOptions(block, step)} onInit={() => { if (step === null) void flow.fitBounds(layout.bounds, { padding: 0.06 }); }} minZoom={0.15} maxZoom={1.5} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} nodesFocusable={false} edgesFocusable={false} zoomOnScroll={false} preventScrolling={false} onPaneClick={() => chooseStep(null)} aria-label="架构图画布" />}
      {!layout && !error && <p role="status" className="absolute inset-0 flex items-center justify-center text-sm text-stone-500">正在排布架构图…</p>}
      {error && <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card text-sm text-stone-700">架构图排布失败<button type="button" onClick={() => { setError(false); setRetry(value => value + 1); }} className="rounded-lg border border-accent-200 px-3 py-2 text-accent-700">重试排布</button></div>}
    </div>
    {steps.length > 0 && <div className="border-t border-stone-200 bg-card px-4 py-3">
      <div role="group" aria-label="架构图讲解步骤" className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={step === null} onClick={() => chooseStep(null)} className={`min-h-9 rounded-lg border px-3 text-xs ${step === null ? "border-secondary-300 bg-secondary-50 text-secondary-700" : "border-stone-200 text-stone-600"}`}>总览</button>
        {steps.map((item, i) => <button key={i} type="button" aria-pressed={step === i} onClick={() => chooseStep(i)} className={`min-h-9 rounded-lg border px-3 text-xs ${step === i ? "border-accent-300 bg-accent-50 text-accent-700" : "border-stone-200 text-stone-600"}`}>{i + 1}. {item.title}</button>)}
      </div>
    </div>}
    <div aria-live="polite" aria-atomic="true" className="min-h-24 border-t border-stone-100 bg-card px-4 py-3">
      <p className="text-sm font-medium text-stone-800">{currentStep?.title ?? selectedNode?.label ?? "探索这张图"}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-stone-600 [overflow-wrap:anywhere]">{currentStep?.description ?? selectedNode?.description ?? "选择模块阅读说明，或切换讲解步骤查看关键节点与连线。可拖动画布移动，双指缩放。"}</p>
    </div>
    <details className="border-t border-stone-100 bg-card px-4 py-2">
      <summary className="min-h-9 cursor-pointer py-2 text-xs text-stone-600">模块导航 · {block.nodes.length} 个模块</summary>
      <div className="flex flex-wrap gap-2 pb-2">{nodeList}</div>
    </details>
  </figure>;
}

export default function DiagramView({ block }: { block: DiagramBlock }) {
  return <ReactFlowProvider><DiagramCanvas key={diagramGeometryKey(block)} block={block} /></ReactFlowProvider>;
}
