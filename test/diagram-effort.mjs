import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { diagramDoc } from "./diagram-fixture.mjs";

const base = "http://127.0.0.1:3100";
const model = "http://127.0.0.1:3101";
let spaceId;
const ids = [];
assert.equal(spawnSync("node", ["--experimental-strip-types", "test/diagram-layout.mjs"], { stdio: "inherit" }).status, 0);
async function run(path, body, outputs) {
  await fetch(model + "/control", { method: "POST", body: JSON.stringify({ outputs }) });
  const response = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal(response.status, 200);
  const events = (await response.text()).split("\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
  const done = events.find(event => event.type === "done");
  if (done?.docId) ids.push(done.docId);
  return { events, done, state: await (await fetch(model + "/state")).json() };
}
try {
  const response = await fetch(base + "/api/spaces", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: `架构图验收-${Date.now()}` }) });
  assert(response.ok);
  ({ id: spaceId } = await response.json());
  const generate = { concept: "Transformer 架构", spaceId, webSearch: false };
  let docId;
  for (const effort of ["low", "high", "max"]) {
    const { done, state } = await run("/api/generate", { ...generate, effort }, [diagramDoc]);
    assert.deepEqual(done?.doc, diagramDoc);
    assert.deepEqual(state.requests.map(request => request.effort), [effort, effort]);
    docId = done.docId;
    const saved = await (await fetch(`${base}/api/docs/${docId}`)).json();
    assert.deepEqual(saved.doc, diagramDoc, "架构图应可从历史读取");
  }
  const broken = [
    diagram => { diagram.nodes[1].id = diagram.nodes[0].id; },
    diagram => { diagram.edges[0].target = "missing_node"; },
    diagram => { diagram.steps[0].edgeIds = ["missing_edge"]; },
    diagram => { diagram.groups.push({ id: "empty", label: "空组" }); },
  ];
  for (const breakDiagram of broken) {
    const invalid = structuredClone(diagramDoc);
    breakDiagram(invalid.blocks[2]);
    const fixed = await run("/api/generate", { ...generate, effort: "max" }, [invalid, diagramDoc]);
    assert.deepEqual(fixed.done?.doc, diagramDoc);
    assert.equal(fixed.state.repairRequests.length, 1);
    assert.deepEqual(fixed.state.requests.map(request => request.effort), ["max", "max", "max"], "修复与复核沿用本轮 effort");
  }
  const invalid = structuredClone(diagramDoc);
  invalid.blocks[2].steps[0].nodeIds = ["missing"];
  const before = (await (await fetch(`${base}/api/docs?spaceId=${spaceId}`)).json()).docs.length;
  const failed = await run("/api/generate", { ...generate, effort: "low" }, [invalid, invalid]);
  assert(!failed.done);
  assert(failed.events.some(event => event.type === "error"));
  assert.equal(failed.state.repairRequests.length, 1);
  assert.equal((await (await fetch(`${base}/api/docs?spaceId=${spaceId}`)).json()).docs.length, before);

  const refined = structuredClone(diagramDoc);
  refined.blocks[2].direction = "TB";
  refined.blocks[2].title = "Transformer 纵向数据流";
  const deeper = await run("/api/refine", { doc: diagramDoc, docId, instruction: "改为纵向架构图", effort: "high" }, [invalid, refined]);
  assert.deepEqual(deeper.done?.doc, refined);
  assert.deepEqual(deeper.state.requests.map(request => request.effort), ["high", "high", "high"]);
  const asked = await run("/api/ask", { docId, question: "交叉注意力的键和值来自哪里？", effort: "low" }, ["来自编码器的输出表示。"]);
  assert(asked.done);
  assert.deepEqual(asked.state.requests.map(request => request.effort), ["low"]);
  assert(asked.events.some(event => event.type === "delta" && event.text.includes("编码器")));
  for (const path of ["/api/generate", "/api/refine", "/api/ask"]) {
    for (const effort of ["medium", "bogus", null]) {
      const invalidEffort = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...generate, doc: diagramDoc, docId, instruction: "解释架构", question: "解释模块", effort }) });
      assert.equal(invalidEffort.status, 400, `${path} 须拒绝无效 effort`);
    }
  }
  const legacy = await run("/api/generate", generate, [diagramDoc]);
  assert(legacy.done, "旧客户端不传 effort 仍可使用服务端配置");
  writeFileSync("data/diagram-effort-fixture.json", JSON.stringify({ spaceId, docId, doc: diagramDoc, refined }));
  assert.equal(spawnSync("python", ["test/diagram-effort-ui.py"], { stdio: "inherit" }).status, 0);
  console.log("PASS: diagram persistence, reference validation, bounded repair, low/high/max in generate/refine/ask/repair and browser interactions");
} finally {
  for (const id of ids) await fetch(`${base}/api/docs/${id}`, { method: "DELETE" });
  if (spaceId) await fetch(`${base}/api/spaces/${spaceId}`, { method: "DELETE" });
}
