import "./source-hooks.mjs";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { inspectTeachingFlow } from "./teaching-cases.mjs";

const { generateSystemPrompt } = await import("../src/lib/llm/prompts.ts");
const { validateDoc } = await import("../src/lib/dsl/schema.ts");
const { teachingContentIssue, studyCards } = await import("../src/lib/study-content.ts");
const { default: katex } = await import("katex");
const examples = generateSystemPrompt().split(/示例[A-Z][^\n]*\n/).slice(1).map(text => JSON.parse(text.trim()));
assert.equal(examples.length, 2);
for (const doc of examples) {
  assert.equal(validateDoc(doc, { rejectUnknownFields: true }), null);
  assert.equal(teachingContentIssue(doc), null);
  const flow = inspectTeachingFlow(doc);
  assert(flow.ordered && flow.predictionIsUngraded && flow.hasObservationActivity && flow.hasTransferQuestion);
  for (const block of doc.blocks) if (block.type === "formula") katex.renderToString(block.latex, { throwOnError: true });
}
const wave = examples[0];
for (const extra of [
  { ...wave, ignoredNote: "不能静默丢掉" },
  { ...wave, blocks: [{ type: "formula", latex: "x", content: "这段正文必须被显示" }] },
  { ...wave, blocks: [{ type: "chart", chartType: "bar", series: [{ data: [1], ignoredNote: "嵌套字段" }] }] },
]) {
  assert.equal(validateDoc(extra), null, "存量文档继续可读");
  assert.match(validateDoc(extra, { rejectUnknownFields: true }), /不是支持的字段/);
}
assert.equal(studyCards(wave).length, 1, "预测文本不生成复习卡，正式变式题才生成");
const misleading = structuredClone(wave);
misleading.blocks.splice(2, 0, wave.blocks.at(-1));
assert.equal(inspectTeachingFlow(misleading).predictionIsUngraded, false, "有四个标题也不能掩盖预测计分");
const noActivity = { ...wave, blocks: wave.blocks.filter(block => block.type !== "wavePlot") };
assert.equal(inspectTeachingFlow(noActivity).hasObservationActivity, false);
assert.equal(inspectTeachingFlow({ version: 1, title: "旧讲解", blocks: [wave.blocks.at(-1)] }).ordered, false);

const base = "http://127.0.0.1:3100", model = "http://127.0.0.1:3101";
const evalRun = process.argv.find(arg => arg.startsWith("--eval-run="))?.slice(11);
if (evalRun && !/^[a-zA-Z0-9_-]+$/.test(evalRun)) throw new Error("无效的验收产物目录");
let spaceId;
try {
  const created = await fetch(base + "/api/spaces", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: `讲解组织验收-${Date.now()}` }) });
  assert(created.ok); ({ id: spaceId } = await created.json());
  await fetch(model + "/control", { method: "POST", body: JSON.stringify({ outputs: [wave] }) });
  const response = await fetch(base + "/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ concept: "正弦波的频率", spaceId, webSearch: false }) });
  const events = (await response.text()).split("\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
  const done = events.find(event => event.type === "done");
  assert.deepEqual(done?.doc, wave);
  const previews = [];
  if (evalRun) {
    const manifest = JSON.parse(readFileSync(resolve("data/teaching-eval", evalRun, "manifest.json"), "utf8"));
    for (const item of manifest.results.filter(item => item.success)) {
      const { doc } = JSON.parse(readFileSync(resolve("data/teaching-eval", evalRun, item.id + ".json"), "utf8"));
      await fetch(model + "/control", { method: "POST", body: JSON.stringify({ outputs: [doc] }) });
      const response = await fetch(base + "/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ concept: item.concept, spaceId, webSearch: false }) });
      const events = (await response.text()).split("\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
      const rendered = events.find(event => event.type === "done");
      assert.deepEqual(rendered?.doc, doc, "真实产物在桌面预览时保持原文");
      previews.push({ id: rendered.docId, caseId: item.id, title: doc.title, diagrams: doc.blocks.filter(block => block.type === "diagram").map(block => ({ title: block.title, nodes: block.nodes.length })) });
    }
  }
  writeFileSync("data/teaching-flow-fixture.json", JSON.stringify({ spaceId, docId: done.docId, evalRun, previews }));
  assert.equal(spawnSync("python", ["test/teaching-flow-ui.py"], { stdio: "inherit" }).status, 0);
  console.log("PASS: prompt examples satisfy real schema/formula/content contracts; desktop prediction, live observation, explanation, transfer and card/attempt accounting");
} finally {
  if (spaceId) await fetch(`${base}/api/spaces/${spaceId}`, { method: "DELETE" });
}
