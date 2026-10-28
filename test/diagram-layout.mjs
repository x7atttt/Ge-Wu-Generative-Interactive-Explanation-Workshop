import assert from "node:assert/strict";
import { layoutDiagram, layoutDiagramCandidates, chooseDiagramLayout, diagramViewport } from "../src/lib/dsl/diagram-layout.ts";
import { diagram } from "./diagram-fixture.mjs";
import { branchDiagram } from "./diagram-branch-fixture.mjs";

const ungrouped = { ...diagram, groups: [], nodes: diagram.nodes.map(({ group, ...node }) => node) };
const cyclic = { ...ungrouped, edges: [...ungrouped.edges, { id: "feedback", source: "output", target: "input" }, { id: "self", source: "input", target: "input" }] };
const groupedCycle = { ...diagram, edges: [...diagram.edges, { id: "feedback", source: "output", target: "input" }] };
const long = structuredClone(diagram);
long.nodes[0].label = "长模块名称与较长英文标识符SuperLongIdentifier".repeat(3).slice(0, 120);
long.groups[0].label = "用于验证标题换行不会盖住模块的长分组名称".repeat(3);
const parallel = { ...diagram, edges: [...diagram.edges, { ...diagram.edges[0], id: "parallel", label: "第二通道" }] };
for (const block of [diagram, { ...diagram, direction: "TB" }, branchDiagram, { ...branchDiagram, direction: "TB" }, parallel, ungrouped, cyclic, groupedCycle, long, { ...ungrouped, edges: [] }]) {
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
    const source = nodes.find(node => node.id === `node:${spec.source}`), target = nodes.find(node => node.id === `node:${spec.target}`);
    assert(source.ports.some(port => port.id === edge.sourceHandle));
    assert(target.ports.some(port => port.id === edge.targetHandle));
  }
}
const pending = layoutDiagramCandidates(branchDiagram);
assert.strictEqual(layoutDiagramCandidates(structuredClone(branchDiagram)), pending, "相同几何共享在途 Promise");
const descriptions = structuredClone(branchDiagram);
descriptions.nodes[0].description = "只改说明，不重新排布";
descriptions.steps[0].description = "步骤文字不改变几何";
assert.strictEqual(layoutDiagramCandidates(descriptions), pending);
const candidates = await pending;
assert(candidates.TB.nodes.find(node => node.id === "node:left").position.x < candidates.TB.nodes.find(node => node.id === "node:right").position.x, "左右分支按阅读顺序排列");
const automatic = chooseDiagramLayout(candidates, 1000, "LR");
assert.equal(automatic.direction, "TB");
assert.deepEqual(automatic.quality, { nodeHits: 0, labelHits: 0, overlap: 0, bends: automatic.quality.bends });
assert(diagramViewport(automatic, 1000).zoom >= 0.85, "分叉汇合总览保持可读");
assert(diagramViewport(automatic, 1000).height <= 900);
for (const item of Object.values(candidates)) {
  const { bounds } = item;
  for (const edge of item.edges) for (const point of edge.points) assert(point.x >= bounds.x && point.y >= bounds.y && point.x <= bounds.x + bounds.width && point.y <= bounds.y + bounds.height);
}
const bad = { ...diagram, edges: [...diagram.edges, { id: "invalid", source: "missing", target: "output" }] };
const failed = layoutDiagramCandidates(bad);
await assert.rejects(failed);
const retried = layoutDiagramCandidates(bad);
assert.notStrictEqual(retried, failed, "失败不占用缓存，重试真正执行");
await assert.rejects(retried);
const retained = layoutDiagramCandidates(diagram);
await Promise.all(Array.from({ length: 16 }, (_, index) => layoutDiagramCandidates({ ...diagram, nodes: diagram.nodes.map((node, i) => i ? node : { ...node, label: `缓存验收${index}` }) })));
assert.notStrictEqual(layoutDiagramCandidates(diagram), retained, "布局缓存限制为16组");
console.log("PASS: grouped/ungrouped LR/TB, cyclic/self edges, disconnected nodes, long labels; no overlapping modules and every edge reaches its endpoints");
