import type { ElkNode, ElkExtendedEdge, LayoutOptions } from "elkjs";
import type { DiagramBlock } from "./diagram-schema";

export interface DiagramLayout {
  nodes: { id: string; position: { x: number; y: number }; width: number; height: number; parentId?: string; group: boolean; label: string; horizontal: boolean }[];
  edges: { id: string; path: string; labelPosition?: { x: number; y: number } }[];
}

const nodeId = (id: string) => `node:${id}`;
const groupId = (id: string) => `group:${id}`;
const options = (horizontal: boolean): LayoutOptions => ({
  "elk.algorithm": "layered", "elk.direction": horizontal ? "RIGHT" : "DOWN",
  "elk.edgeRouting": "ORTHOGONAL", "elk.spacing.nodeNode": "28",
  "elk.layered.spacing.nodeNodeBetweenLayers": "40", "elk.padding": "[top=24,left=24,bottom=24,right=24]",
});

function leaf(node: DiagramBlock["nodes"][number], horizontal: boolean): ElkNode {
  const textWidth = [...node.label].reduce((width, ch) => width + (/[^\x00-\x7F]/.test(ch) ? 14 : 8), 0);
  const width = 188, height = Math.max(60, 24 + Math.ceil(textWidth / 160) * 22);
  // 固定端口保证只有跨组连线的叶节点也有稳定锚点。
  return { id: nodeId(node.id), width, height, layoutOptions: { "elk.portConstraints": "FIXED_POS" }, ports: [
    { id: `${nodeId(node.id)}:in`, x: horizontal ? 0 : width / 2, y: horizontal ? height / 2 : 0, layoutOptions: { "elk.port.side": horizontal ? "WEST" : "NORTH" } },
    { id: `${nodeId(node.id)}:out`, x: horizontal ? width : width / 2, y: horizontal ? height / 2 : height, layoutOptions: { "elk.port.side": horizontal ? "EAST" : "SOUTH" } },
  ] };
}

function elkEdge(edge: DiagramBlock["edges"][number]): ElkExtendedEdge {
  return { id: edge.id, sources: [`${nodeId(edge.source)}:out`], targets: [`${nodeId(edge.target)}:in`],
    ...(edge.label ? { labels: [{ text: edge.label, width: Math.min(200, [...edge.label].length * 13), height: 20 }] } : {}),
  };
}

function placedEdge(edge: ElkExtendedEdge, offset = { x: 0, y: 0 }): DiagramLayout["edges"][number] {
  if (!edge.sections?.length) throw new Error(`连线 ${edge.id} 缺少布局路径`);
  return {
    id: edge.id,
    path: edge.sections.map(section => [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((point, i) => `${i ? "L" : "M"} ${point.x + offset.x} ${point.y + offset.y}`).join(" ")).join(" "),
    labelPosition: edge.labels?.[0] ? { x: edge.labels[0].x! + offset.x, y: edge.labels[0].y! + offset.y } : undefined,
  };
}

/** 分别排布组内与组间关系，避免复合布局把所有层级拉成同一条长链。 */
export async function layoutDiagram(block: DiagramBlock): Promise<DiagramLayout> {
  const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
  const elk = new ELK();
  const horizontal = block.direction !== "TB";
  const members = new Map(block.nodes.map(node => [node.id, node.group]));
  const internal = (edge: DiagramBlock["edges"][number]) => members.get(edge.source) !== undefined && members.get(edge.source) === members.get(edge.target);
  const groups = await Promise.all((block.groups ?? []).map(group => elk.layout<ElkNode>({
    id: groupId(group.id), layoutOptions: { ...options(false), "elk.padding": `[top=${Math.max(48, 28 + Math.ceil([...group.label].length * 13 / 188) * 20)},left=24,bottom=24,right=24]` },
    children: block.nodes.filter(node => node.group === group.id).map(node => leaf(node, false)),
    edges: block.edges.filter(edge => internal(edge) && members.get(edge.source) === group.id).map(elkEdge),
  })));
  const result = await elk.layout({
    id: "diagram-root", layoutOptions: options(horizontal),
    children: [
      ...groups.map(group => ({ id: group.id, width: group.width, height: group.height,
        layoutOptions: { "elk.portConstraints": "FIXED_POS" },
        ports: group.children!.flatMap(child => child.ports!.map(port => {
          const incoming = port.id.endsWith(":in");
          return { id: port.id, x: incoming ? 0 : group.width!, y: incoming ? child.y! - 12 : child.y! + child.height! + 12,
            layoutOptions: { "elk.port.side": incoming ? "WEST" : "EAST" },
          };
        })),
      })),
      ...block.nodes.filter(node => !node.group).map(node => leaf(node, horizontal)),
    ],
    edges: block.edges.filter(edge => !internal(edge)).map(elkEdge),
  });
  const nodes: DiagramLayout["nodes"] = [];
  const edges: DiagramLayout["edges"] = [];
  for (const node of result.children ?? []) {
    const group = groups.find(item => item.id === node.id);
    const position = { x: node.x!, y: node.y! };
    if (group) {
      nodes.push({ id: node.id, position, width: node.width!, height: node.height!, group: true, horizontal, label: block.groups!.find(item => groupId(item.id) === node.id)!.label });
      for (const child of group.children!) {
        nodes.push({ id: child.id, position: { x: child.x!, y: child.y! }, width: child.width!, height: child.height!, parentId: node.id, group: false, horizontal: false, label: block.nodes.find(item => nodeId(item.id) === child.id)!.label });
      }
      edges.push(...(group.edges ?? []).map(edge => placedEdge(edge, position)));
    } else {
      nodes.push({ id: node.id, position, width: node.width!, height: node.height!, group: false, horizontal, label: block.nodes.find(item => nodeId(item.id) === node.id)!.label });
    }
  }
  for (const edge of result.edges ?? []) {
    const placed = placedEdge(edge);
    const source = block.edges.find(item => item.id === edge.id)!;
    // 组间边在分组边界路由，再沿节点之间的留白接到组内模块。
    for (const [endpoint, key] of [["source", "out"], ["target", "in"]] as const) {
      const child = nodes.find(node => node.id === nodeId(source[endpoint]))!;
      if (!child.parentId) continue;
      const parent = result.children!.find(node => node.id === child.parentId)!;
      const port = parent.ports!.find(item => item.id === `${child.id}:${key}`)!;
      const x = parent.x! + child.position.x + child.width / 2;
      const y = parent.y! + child.position.y + (key === "out" ? child.height : 0);
      const portX = parent.x! + port.x!, portY = parent.y! + port.y!;
      if (key === "out") placed.path = `M ${x} ${y} L ${x} ${portY} L ${portX} ${portY} ${placed.path.replace(/^M/, "L")}`;
      else placed.path += ` L ${x} ${portY} L ${x} ${y}`;
    }
    edges.push(placed);
  }
  return { nodes, edges };
}
