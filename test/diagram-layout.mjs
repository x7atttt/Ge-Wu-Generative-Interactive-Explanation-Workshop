import assert from "node:assert/strict";
import { layoutDiagram } from "../src/lib/dsl/diagram-layout.ts";
import { diagram } from "./diagram-fixture.mjs";

const ungrouped = { ...diagram, groups: [], nodes: diagram.nodes.map(({ group, ...node }) => node) };
const cyclic = { ...ungrouped, edges: [...ungrouped.edges, { id: "feedback", source: "output", target: "input" }, { id: "self", source: "input", target: "input" }] };
const groupedCycle = { ...diagram, edges: [...diagram.edges, { id: "feedback", source: "output", target: "input" }] };
const long = structuredClone(diagram);
long.nodes[0].label = "长模块名称与较长英文标识符SuperLongIdentifier".repeat(3).slice(0, 120);
long.groups[0].label = "用于验证标题换行不会盖住模块的长分组名称".repeat(3);
for (const block of [diagram, { ...diagram, direction: "TB" }, ungrouped, cyclic, groupedCycle, long, { ...ungrouped, edges: [] }]) {
  const { nodes, edges } = await layoutDiagram(block);
  const global = new Map(nodes.filter(node => !node.group).map(node => {
    const parent = nodes.find(item => item.id === node.parentId);
    return [node.id.slice(5), { x: node.position.x + (parent?.position.x ?? 0), y: node.position.y + (parent?.position.y ?? 0), width: node.width, height: node.height }];
  }));
  assert.equal(global.size, block.nodes.length);
  assert.equal(edges.length, block.edges.length);
  for (const rect of global.values()) assert(Object.values(rect).every(Number.isFinite));
  const rectangles = [...global.values()];
  rectangles.forEach((a, index) => rectangles.slice(index + 1).forEach(b => {
    assert(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, "模块不得互相遮盖");
  }));
  for (const edge of edges) {
    const spec = block.edges.find(item => item.id === edge.id);
    const points = [...edge.path.matchAll(/[ML] ([\d.e+-]+) ([\d.e+-]+)/g)].map(match => ({ x: Number(match[1]), y: Number(match[2]) }));
    for (const [point, id] of [[points[0], spec.source], [points.at(-1), spec.target]]) {
      const rect = global.get(id);
      assert(point.x >= rect.x - 0.01 && point.x <= rect.x + rect.width + 0.01, `连线 ${edge.id} 必须接到 ${id}`);
      assert(point.y >= rect.y - 0.01 && point.y <= rect.y + rect.height + 0.01, `连线 ${edge.id} 必须接到 ${id}`);
    }
  }
}
console.log("PASS: grouped/ungrouped LR/TB, cyclic/self edges, disconnected nodes, long labels; no overlapping modules and every edge reaches its endpoints");
