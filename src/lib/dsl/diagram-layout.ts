import type ELK from "elkjs";
import type { ElkNode, ElkExtendedEdge } from "elkjs";
import type { DiagramBlock } from "./diagram-schema";

type Point = { x: number; y: number };
export type DiagramRect = Point & { width: number; height: number };
export type DiagramPort = Point & { id: string; type: "source" | "target"; side: "NORTH" | "SOUTH" | "EAST" | "WEST" };
export type DiagramDirection = "LR" | "TB";
export interface DiagramLayout {
  direction: DiagramDirection;
  bounds: DiagramRect;
  quality: { nodeHits: number; labelHits: number; overlap: number; bends: number };
  nodes: { id: string; position: Point; width: number; height: number; parentId?: string; group: boolean; label: string; horizontal: boolean; ports: DiagramPort[]; labelPosition?: Point }[];
  edges: { id: string; path: string; points: Point[]; sourceHandle: string; targetHandle: string; labelPosition?: Point; labelWidth?: number; labelHeight?: number; label?: string }[];
}
export type DiagramCandidates = Record<DiagramDirection, DiagramLayout>;
const nodeId = (id: string) => `node:${id}`;
const groupId = (id: string) => `group:${id}`;
const portId = (edge: string, type: "in" | "out") => `port:${edge}:${type}`;
type LayoutEngine = InstanceType<typeof ELK>;
let engine: Promise<LayoutEngine> | undefined;
let queue: Promise<unknown> = Promise.resolve();
const cache = new Map<string, Promise<DiagramCandidates>>();

/** 说明、步骤和图标题不会改变画布几何，预览转成品复用计算。 */
export function diagramGeometryKey(block: DiagramBlock): string {
  return JSON.stringify({ nodes: block.nodes.map(({ id, label, group }) => ({ id, label, group })), edges: block.edges.map(({ id, source, target, label }) => ({ id, source, target, label })), groups: block.groups });
}

function textBox(text: string, fontSize: number, weight: number, maxWidth: number, lineHeight: number) {
  const context = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  if (context) context.font = `${weight} ${fontSize}px ${getComputedStyle(document.body).fontFamily}`;
  const measure = (value: string) => context?.measureText(value).width ?? [...value].reduce((sum, ch) => sum + (/[^\x00-\x7F]/.test(ch) ? fontSize : fontSize * 0.58), 0);
  const lines: string[] = [];
  let line = "";
  for (const char of text) {
    if (char === "\n" || (line && measure(line + char) > maxWidth)) { lines.push(line); line = ""; }
    if (char !== "\n") line += char;
  }
  lines.push(line);
  return { text: lines.join("\n"), width: Math.max(1, ...lines.map(measure)), height: lines.length * lineHeight };
}

/** 同一引擎顺序计算，失败清除缓存；缓存也共享正在计算的 Promise。 */
export function layoutDiagramCandidates(block: DiagramBlock): Promise<DiagramCandidates> {
  const family = typeof document === "undefined" ? "node-test" : getComputedStyle(document.body).fontFamily;
  const key = `${diagramGeometryKey(block)}|${family}`;
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
  const task = queue.then(async () => {
    if (typeof document !== "undefined") await document.fonts.ready;
    engine ??= import("elkjs/lib/elk.bundled.js").then(({ default: Constructor }) => new Constructor());
    const elk = await engine;
    return { LR: await runLayout(elk, block, "LR"), TB: await runLayout(elk, block, "TB") };
  });
  queue = task.catch(() => {});
  cache.set(key, task);
  if (cache.size > 16) cache.delete(cache.keys().next().value!);
  void task.catch(() => { if (cache.get(key) === task) cache.delete(key); });
  return task;
}

export async function layoutDiagram(block: DiagramBlock, direction = block.direction ?? "LR"): Promise<DiagramLayout> {
  return (await layoutDiagramCandidates(block))[direction];
}

async function runLayout(elk: LayoutEngine, block: DiagramBlock, direction: DiagramDirection): Promise<DiagramLayout> {
  const horizontal = direction === "LR";
  const labels = new Map(block.edges.filter(edge => edge.label).map(edge => [edge.id, textBox(edge.label!, 12, 400, 172, 16)]));
  const member = new Map(block.nodes.map(node => [node.id, node.group]));
  const internal = (edge: DiagramBlock["edges"][number], group: string) => member.get(edge.source) === group && member.get(edge.target) === group;
  const leaf = (node: DiagramBlock["nodes"][number]): ElkNode => {
    const label = textBox(node.label, 14, 500, 196, 22);
    const degree = Math.max(block.edges.filter(edge => edge.source === node.id).length, block.edges.filter(edge => edge.target === node.id).length);
    return { id: nodeId(node.id), width: horizontal ? 220 : Math.max(220, (degree + 1) * 14), height: Math.max(60, label.height + 24, horizontal ? (degree + 1) * 14 : 0),
      layoutOptions: { "elk.portConstraints": "FIXED_ORDER" },
      // ELK 按顺时针排列固定端口；底边/左边反转，以保持分支的阅读顺序。
      ports: [
        ...(horizontal ? block.edges.filter(edge => edge.target === node.id).reverse() : block.edges.filter(edge => edge.target === node.id)).map(edge => ({ id: portId(edge.id, "in"), layoutOptions: { "elk.port.side": horizontal ? "WEST" : "NORTH" } })),
        ...(horizontal ? block.edges.filter(edge => edge.source === node.id) : block.edges.filter(edge => edge.source === node.id).reverse()).map(edge => ({ id: portId(edge.id, "out"), layoutOptions: { "elk.port.side": horizontal ? "EAST" : "SOUTH" } })),
      ].map((port, index) => ({ ...port, layoutOptions: { ...port.layoutOptions, "elk.port.index": String(index) } })),
    };
  };
  const edge = (item: DiagramBlock["edges"][number]): ElkExtendedEdge => {
    const label = labels.get(item.id);
    return { id: item.id, sources: [portId(item.id, "out")], targets: [portId(item.id, "in")], ...(label ? { labels: [{ text: label.text, width: label.width + 8, height: label.height + 4 }] } : {}) };
  };
  const graph = await elk.layout({ id: "diagram-root", layoutOptions: {
    "elk.algorithm": "layered", "elk.direction": horizontal ? "RIGHT" : "DOWN", "elk.hierarchyHandling": "INCLUDE_CHILDREN",
    "elk.edgeRouting": "ORTHOGONAL", "elk.layered.mergeEdges": "false", "elk.layered.mergeHierarchyEdges": "false",
    "elk.spacing.nodeNode": "32", "elk.layered.spacing.nodeNodeBetweenLayers": "56", "elk.spacing.edgeEdge": "18", "elk.spacing.edgeNode": "24",
    "elk.layered.spacing.edgeEdgeBetweenLayers": "18", "elk.layered.spacing.edgeNodeBetweenLayers": "24", "elk.padding": "[top=24,left=24,bottom=24,right=24]",
  }, children: [
    ...(block.groups ?? []).map(group => {
      const label = textBox(group.label, 13, 500, 220, 20);
      return { id: groupId(group.id), layoutOptions: { "elk.nodeLabels.placement": "[H_LEFT, V_TOP, INSIDE]", "elk.padding": `[top=${label.height + 36},left=24,bottom=24,right=24]` },
        labels: [{ text: label.text, width: label.width, height: label.height }], children: block.nodes.filter(node => node.group === group.id).map(leaf), edges: block.edges.filter(item => internal(item, group.id)).map(edge) };
    }),
    ...block.nodes.filter(node => !node.group).map(leaf),
  ], edges: block.edges.filter(item => !member.get(item.source) || member.get(item.source) !== member.get(item.target)).map(edge) });

  const nodes: DiagramLayout["nodes"] = [], edges: DiagramLayout["edges"] = [];
  const offsets = new Map<string, Point>([[graph.id, { x: 0, y: 0 }]]);
  const pending: { edge: ElkExtendedEdge; owner: string }[] = [];
  const visit = (parent: ElkNode, offset: Point) => {
    for (const item of parent.edges ?? []) pending.push({ edge: item, owner: parent.id });
    for (const item of parent.children ?? []) {
      const group = item.id.startsWith("group:");
      const label = group ? item.labels![0] : textBox(block.nodes.find(node => nodeId(node.id) === item.id)!.label, 14, 500, 196, 22);
      nodes.push({ id: item.id, position: { x: item.x!, y: item.y! }, width: item.width!, height: item.height!, parentId: parent.id === graph.id ? undefined : parent.id, group, horizontal,
        label: label.text!, labelPosition: group ? { x: item.labels![0].x!, y: item.labels![0].y! } : undefined,
        ports: (item.ports ?? []).map(port => ({ id: port.id, x: port.x!, y: port.y!, type: port.id.endsWith(":in") ? "target" : "source", side: port.id.endsWith(":in") ? horizontal ? "WEST" : "NORTH" : horizontal ? "EAST" : "SOUTH" })),
      });
      const absolute = { x: offset.x + item.x!, y: offset.y + item.y! };
      offsets.set(item.id, absolute); visit(item, absolute);
    }
  };
  visit(graph, { x: 0, y: 0 });
  for (const { edge: item, owner } of pending) {
    if (!item.sections?.length) throw new Error(`连线 ${item.id} 缺少布局路径`);
    const offset = offsets.get((item as ElkExtendedEdge & { container?: string }).container ?? owner)!;
    const points = item.sections.flatMap(section => [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(point => ({ x: point.x + offset.x, y: point.y + offset.y })));
    const label = item.labels?.[0];
    edges.push({ id: item.id, points, sourceHandle: portId(item.id, "out"), targetHandle: portId(item.id, "in"),
      path: points.map((point, i) => `${i ? "L" : "M"} ${point.x} ${point.y}`).join(" "),
      ...(label ? { label: label.text, labelPosition: { x: label.x! + offset.x, y: label.y! + offset.y }, labelWidth: label.width, labelHeight: label.height } : {}),
    });
  }
  const rectangles = nodes.map(node => ({ ...offsets.get(node.id)!, width: node.width, height: node.height }));
  const edgeLabels = edges.flatMap(item => item.labelPosition ? [{ ...item.labelPosition, width: item.labelWidth!, height: item.labelHeight! }] : []);
  const extents = [...rectangles, ...edgeLabels, ...edges.flatMap(item => item.points.map(point => ({ ...point, width: 0, height: 0 })))];
  const x = Math.min(...extents.map(rect => rect.x)), y = Math.min(...extents.map(rect => rect.y));
  const bounds = { x, y, width: Math.max(...extents.map(rect => rect.x + rect.width)) - x, height: Math.max(...extents.map(rect => rect.y + rect.height)) - y };
  return { direction, nodes, edges, bounds, quality: layoutQuality(block, nodes, edges, offsets, edgeLabels) };
}

const overlaps = (a: DiagramRect, b: DiagramRect) => a.x < b.x + b.width - 0.1 && a.x + a.width > b.x + 0.1 && a.y < b.y + b.height - 0.1 && a.y + a.height > b.y + 0.1;
function segmentHits(a: Point, b: Point, rect: DiagramRect) {
  return Math.abs(a.x - b.x) < 0.01 ? a.x > rect.x + 0.1 && a.x < rect.x + rect.width - 0.1 && Math.max(a.y, b.y) > rect.y + 0.1 && Math.min(a.y, b.y) < rect.y + rect.height - 0.1
    : a.y > rect.y + 0.1 && a.y < rect.y + rect.height - 0.1 && Math.max(a.x, b.x) > rect.x + 0.1 && Math.min(a.x, b.x) < rect.x + rect.width - 0.1;
}
function layoutQuality(block: DiagramBlock, nodes: DiagramLayout["nodes"], edges: DiagramLayout["edges"], offsets: Map<string, Point>, labels: DiagramRect[]) {
  const leaves = nodes.filter(node => !node.group).map(node => ({ id: node.id, ...offsets.get(node.id)!, width: node.width, height: node.height }));
  const headers = nodes.filter(node => node.group).map(node => {
    const size = textBox(node.label, 13, 500, 220, 20), offset = offsets.get(node.id)!;
    return { x: offset.x + node.labelPosition!.x, y: offset.y + node.labelPosition!.y, width: size.width, height: size.height };
  });
  let nodeHits = 0, labelHits = 0, overlap = 0, bends = 0;
  const segments: { edge: string; a: Point; b: Point }[] = [];
  for (const item of edges) {
    const spec = block.edges.find(edge => edge.id === item.id)!;
    bends += Math.max(0, item.points.length - 2);
    for (let i = 1; i < item.points.length; i++) {
      const a = item.points[i - 1], b = item.points[i];
      nodeHits += leaves.filter(rect => rect.id !== nodeId(spec.source) && rect.id !== nodeId(spec.target) && segmentHits(a, b, rect)).length;
      labelHits += headers.filter(rect => segmentHits(a, b, rect)).length;
      segments.push({ edge: item.id, a, b });
    }
  }
  labels.forEach((label, i) => { labelHits += [...leaves, ...headers].filter(rect => overlaps(label, rect)).length + labels.slice(i + 1).filter(other => overlaps(label, other)).length; });
  for (const item of edges.filter(edge => edge.labelPosition)) {
    const rect = { ...item.labelPosition!, width: item.labelWidth!, height: item.labelHeight! };
    labelHits += segments.filter(segment => segment.edge !== item.id && segmentHits(segment.a, segment.b, rect)).length;
  }
  segments.forEach((a, i) => segments.slice(i + 1).forEach(b => {
    if (a.edge === b.edge) return;
    if (Math.abs(a.a.x - a.b.x) < 0.01 && Math.abs(b.a.x - b.b.x) < 0.01 && Math.abs(a.a.x - b.a.x) < 0.01) overlap += Math.max(0, Math.min(Math.max(a.a.y, a.b.y), Math.max(b.a.y, b.b.y)) - Math.max(Math.min(a.a.y, a.b.y), Math.min(b.a.y, b.b.y)));
    if (Math.abs(a.a.y - a.b.y) < 0.01 && Math.abs(b.a.y - b.b.y) < 0.01 && Math.abs(a.a.y - b.a.y) < 0.01) overlap += Math.max(0, Math.min(Math.max(a.a.x, a.b.x), Math.max(b.a.x, b.b.x)) - Math.max(Math.min(a.a.x, a.b.x), Math.min(b.a.x, b.b.x)));
  }));
  return { nodeHits, labelHits, overlap, bends };
}

export function diagramViewport(layout: DiagramLayout, width: number) {
  const height = Math.max(420, Math.min(900, Math.ceil(layout.bounds.height * Math.min(1, Math.max(1, width - 32) / Math.max(1, layout.bounds.width)) + 32)));
  const zoom = Math.min(1, Math.max(1, width - 32) / Math.max(1, layout.bounds.width), (height - 32) / Math.max(1, layout.bounds.height));
  return { height, zoom };
}
export function chooseDiagramLayout(candidates: DiagramCandidates, width: number, preferred: DiagramDirection = "LR"): DiagramLayout {
  const score = (layout: DiagramLayout) => {
    const view = diagramViewport(layout, width);
    return [layout.quality.nodeHits, layout.quality.labelHits, layout.quality.overlap, -view.zoom, view.height * width - layout.bounds.width * layout.bounds.height * view.zoom ** 2, layout.quality.bends, layout.direction === preferred ? 0 : 1];
  };
  const a = score(candidates.LR), b = score(candidates.TB);
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 0.001) return a[i] < b[i] ? candidates.LR : candidates.TB;
  return candidates[preferred];
}
