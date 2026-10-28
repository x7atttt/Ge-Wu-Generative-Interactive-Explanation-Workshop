import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const base = "http://127.0.0.1:3100", model = "http://127.0.0.1:3101";
assert.equal(spawnSync("node", ["--experimental-strip-types", "test/llm-transport.mjs"], { stdio: "inherit" }).status, 0);
const valid = { version: 1, title: "网络恢复验收", blocks: [
  { type: "text", content: "这是重试后完整的讲解。" },
  { type: "quiz", question: "哪项说明连接已恢复？", options: ["完整内容返回", "仍在等待"], answer: 0, explanation: "本轮内容已经完整返回。" },
] };
const invalid = { ...valid, blocks: [{ type: "slider", var: "orphan", label: "非法滑块", min: 1, max: 5, step: 1, initial: 2 }] };
let spaceId;
const configure = options => fetch(model + "/control", { method: "POST", body: JSON.stringify(options) });
const state = async () => (await fetch(model + "/state")).json();
async function waitFor(condition) {
  const end = Date.now() + 2000;
  while (!await condition()) { assert(Date.now() < end, "取消应及时中止上游"); await delay(10); }
}
async function request(path, body, signal, events = []) {
  const response = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  assert.equal(response.status, 200, "取消后新请求不应继续被 409 阻挡");
  const completed = (async () => {
    let buffer = "";
    const decoder = new TextDecoder();
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const frames = buffer.split("\n\n"); buffer = frames.pop() ?? "";
      for (const frame of frames) for (const line of frame.split("\n")) if (line.startsWith("data: ")) events.push(JSON.parse(line.slice(6)));
    }
    return events;
  })().catch(error => { if (signal?.aborted) return events; throw error; });
  return { completed, events };
}
try {
  const response = await fetch(base + "/api/spaces", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: `取消重试验收-${Date.now()}` }) });
  assert(response.ok); ({ id: spaceId } = await response.json());
  const generate = { concept: "网络恢复", spaceId, webSearch: false, effort: "max" };
  const docs = async () => (await (await fetch(`${base}/api/docs?spaceId=${spaceId}`)).json()).docs;
  await configure({ faults: [{ status: 503 }, { status: 502 }], outputs: [valid] });
  const recovered = await (await request("/api/generate", generate)).completed;
  assert.deepEqual(recovered.filter(e => e.type === "retry").map(e => e.attempt), [1, 2]);
  const parent = recovered.find(e => e.type === "done");
  assert.deepEqual(parent.doc, valid);
  assert.deepEqual((await state()).requests.map(r => r.effort), ["max", "max", "max", "max"]);
  for (const path of ["/api/generate", "/api/refine", "/api/ask"]) {
    await configure({ faults: [{ mode: "reasoning", delay: 300 }], outputs: [path === "/api/ask" ? "完整回答" : valid] });
    const body = path === "/api/ask" ? { docId: parent.docId, question: "解释等待过程" } : path === "/api/refine" ? { doc: valid, docId: parent.docId, instruction: "补充说明" } : generate;
    const events = await (await request(path, body)).completed;
    assert.equal(events.filter(e => e.type === "info" && e.message === "模型正在思考，尚未返回正文").length, 1);
    assert(!JSON.stringify(events).includes("private test reasoning"), "思考正文不通过 SSE 下发");
    assert(events.some(e => e.type === "done"));
  }
  const afterThinking = (await docs()).length;
  for (const [faults, expected] of [[[{ status: 503 }, { status: 503 }, { status: 503 }], 3], [[{ status: 401 }], 1]]) {
    await configure({ faults, outputs: [valid] });
    const events = await (await request("/api/generate", generate)).completed;
    assert(events.some(e => e.type === "error"));
    assert(!events.some(e => e.type === "done"));
    assert.equal((await state()).requests.length, expected);
    assert.equal((await docs()).length, afterThinking, "失败请求不落库");
  }
  await configure({ faults: [{ mode: "partial" }], outputs: [valid] });
  const restarted = await (await request("/api/generate", generate)).completed;
  assert(restarted.some(e => e.type === "retry"));
  assert.deepEqual(restarted.find(e => e.type === "done")?.doc, valid);
  assert.equal((await state()).repairRequests.length, 0, "网络中断不应被误当作文档校验失败");
  await configure({ faults: [{ mode: "partial", text: "废弃回答" }], outputs: ["恢复后的完整回答"] });
  const answer = await (await request("/api/ask", { docId: parent.docId, question: "解释恢复过程", effort: "low" })).completed;
  assert(answer.some(e => e.type === "retry"));
  assert(answer.some(e => e.type === "done"));
  const saved = await (await fetch(`${base}/api/docs/${parent.docId}`)).json();
  assert.equal(saved.asks.at(-1).content, "恢复后的完整回答", "追问只保存成功重试后的回答");

  for (const kind of ["generate", "refine", "repair", "stream"]) {
    const originalCount = (await docs()).length;
    await configure({ delay: kind === "generate" || kind === "refine" ? 60000 : 0, streamPause: kind === "stream" ? 60000 : 0, repairDelay: kind === "repair" ? 60000 : 0, outputs: kind === "repair" ? [invalid, valid, valid] : [valid, valid] });
    const controller = new AbortController();
    const body = kind === "refine" ? { doc: valid, docId: parent.docId, instruction: "详细解释", effort: "high" } : generate;
    const pending = await request(kind === "refine" ? "/api/refine" : "/api/generate", body, controller.signal);
    await waitFor(async () => kind === "repair" ? (await state()).repairRequests.length === 1 : (await state()).pending);
    controller.abort();
    if (kind === "stream") await configure({ outputs: [valid] });
    const next = await (await request("/api/generate", generate)).completed;
    assert(next.some(e => e.type === "done"));
    await pending.completed;
    await waitFor(async () => !(await state()).pending);
    assert.equal((await docs()).length, originalCount + 1, `${kind} 取消后只保存新请求`);
    if (kind !== "stream") assert((await state()).cancellations >= 1, `${kind} 确实关闭上游连接`);
  }
  await configure({ faults: [{ status: 503 }], outputs: [valid] });
  const controller = new AbortController();
  const pending = await request("/api/generate", generate, controller.signal);
  await waitFor(() => pending.events.some(e => e.type === "retry"));
  controller.abort(); await pending.completed;
  await delay(900);
  assert.equal((await state()).requests.length, 1, "重试等待中取消不得再发上游请求");
  writeFileSync("data/generation-transport-fixture.json", JSON.stringify({ spaceId, valid }));
  assert.equal(spawnSync("python", ["test/generation-transport-ui.py"], { stdio: "inherit" }).status, 0);
  const timing = readFileSync("data/test-server-3100.log", "utf8").split("\n").filter(line => line.startsWith("[llm/timing] ")).map(line => JSON.parse(line.slice(13)));
  for (const phase of ["generate", "refine", "ask", "repair", "review"]) assert(timing.some(item => item.phase === phase), `真实接口应记录 ${phase} 阶段耗时`);
  assert(timing.some(item => item.outcome === "cancelled"));
  assert(timing.some(item => item.attempts === 3 && item.outcome === "success"));
  console.log("PASS: real routes retry twice, preserve effort, cancel before headers/during stream/repair/refine/backoff, immediately restart, no duplicate or cancelled docs");
} finally {
  if (spaceId) await fetch(`${base}/api/spaces/${spaceId}`, { method: "DELETE" });
}
