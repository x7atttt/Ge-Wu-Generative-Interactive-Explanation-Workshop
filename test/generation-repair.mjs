import assert from "node:assert/strict";

const base = "http://127.0.0.1:3100";
const model = "http://127.0.0.1:3101";
const ids = [];
let spaceId;
const valid = { version: 1, title: "架构讲解修复验收", blocks: [
  { type: "text", content: "本例使用固定维度说明流程，不提供维度滑块。" },
  { type: "formula", latex: "d_k = 64", caption: "键向量维度，作为固定示例。" },
  { type: "quiz", question: "本例展示的键向量维度是多少？", options: ["64", "32"], answer: 0, explanation: "本例固定为 64。" },
] };
const invalid = { ...valid, blocks: [
  { type: "text", content: "待修原文".repeat(2500) },
  { type: "slider", var: "dk", label: "键向量维度", min: 1, max: 128, step: 1, initial: 64 },
  ...valid.blocks.slice(1),
] };
const fixed = { ...valid, blocks: [invalid.blocks[0], ...valid.blocks.slice(1)] };

async function run(path, body, outputs) {
  await fetch(model + "/control", { method: "POST", body: JSON.stringify({ outputs }) });
  const response = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal(response.status, 200);
  const events = (await response.text()).split("\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
  for (const event of events) if (event.type === "done") ids.push(event.docId);
  return { events, state: await (await fetch(model + "/state")).json() };
}

try {
  const response = await fetch(base + "/api/spaces", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: `交互修复验收-${Date.now()}` }) });
  assert(response.ok);
  ({ id: spaceId } = await response.json());
  const generate = { concept: "架构讲解", spaceId, webSearch: false };
  for (const [path, body] of [["/api/generate", generate], ["/api/refine", { doc: valid, instruction: "详细解释固定维度示例" }]]) {
    const { events, state } = await run(path, body, [invalid, fixed]);
    assert.equal(state.repairRequests.length, 1);
    const messages = state.repairRequests[0];
    const original = messages.find(message => message.role === "assistant").content;
    assert(original === JSON.stringify(invalid), `${path} 修复原文长度 ${original.length}，期望 ${JSON.stringify(invalid).length}；必须完整保留中文、尾部滑块和公式`);
    assert.equal(messages.filter(message => message.role === "system").length, 1, "修复使用单一系统指令，避免生成/改造指令覆盖修复任务");
    assert.match(messages[0].content, /公式.*静态/);
    assert.match(messages[0].content, /表达式/);
    assert.match(messages.at(-1).content, /dk/);
    assert.deepEqual(events.filter(event => event.type === "stage").map(event => event.stage), ["build", "verify", "repair", "verify", "review"]);
    assert.deepEqual(events.find(event => event.type === "done")?.doc, fixed);
    assert.equal(state.remaining, 0);
  }
  const lostText = { ...valid, blocks: [{ type: "formula", latex: "n!", content: "这段解释必须保留并显示。" }, ...valid.blocks] };
  const recoveredText = { ...valid, blocks: [{ type: "text", content: "这段解释必须保留并显示。" }, { type: "formula", latex: "n!" }, ...valid.blocks] };
  for (const path of ["/api/generate", "/api/refine"]) {
    const body = path === "/api/generate" ? generate : { doc: valid, instruction: "补充公式说明" };
    const result = await run(path, body, [lostText, recoveredText]);
    assert.equal(result.state.repairRequests.length, 1, "未渲染字段必须触发修复");
    assert.match(result.state.repairRequests[0].at(-1).content, /blocks\.0\.content/);
    assert.deepEqual(result.events.find(event => event.type === "done")?.doc, recoveredText, "修复应迁移解释而非静默丢弃");
  }
  const before = (await (await fetch(`${base}/api/docs?spaceId=${spaceId}`)).json()).docs.length;
  const rejectedText = await run("/api/generate", generate, [lostText, lostText]);
  assert(rejectedText.events.some(event => event.type === "error" && event.message.includes("blocks.0.content")));
  assert(!rejectedText.events.some(event => event.type === "done"));
  assert.equal((await (await fetch(`${base}/api/docs?spaceId=${spaceId}`)).json()).docs.length, before);
  const failed = await run("/api/generate", generate, [invalid, invalid]);
  assert(failed.events.some(event => event.type === "error" && event.message.includes("滑块 dk")));
  assert(!failed.events.some(event => event.type === "done"));
  assert.equal(failed.state.repairRequests.length, 1, "修复次数仍然有界");
  assert.equal((await (await fetch(`${base}/api/docs?spaceId=${spaceId}`)).json()).docs.length, before, "无效滑块不得落库");

  const interactive = { ...valid, blocks: [
    { type: "slider", var: "dk", label: "示例维度", min: 1, max: 128, step: 1, initial: 64 },
    { type: "chart", chartType: "bar", categories: ["当前维度"], series: [{ data: [{ $var: "dk" }] }] },
  ] };
  const accepted = await run("/api/generate", generate, [interactive]);
  assert.deepEqual(accepted.events.find(event => event.type === "done")?.doc, interactive);
  assert.equal(accepted.state.repairRequests.length, 0, "真实绑定的滑块不触发修复");
  console.log("PASS: generate/refine repair receives full long document, one authoritative system task, unsupported formula-only slider is repaired or rejected, real bindings remain valid");
} finally {
  for (const id of ids) await fetch(`${base}/api/docs/${id}`, { method: "DELETE" });
  if (spaceId) await fetch(`${base}/api/spaces/${spaceId}`, { method: "DELETE" });
}
