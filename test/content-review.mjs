import "./source-hooks.mjs";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const { factorialFacts, factorialFormulaIssue, factorialPremiseIssue, partitionFacts, readContentReview, reviewTargets, reviewContent } = await import("../src/lib/dsl/content-review.ts");
const { teachingContentIssue } = await import("../src/lib/study-content.ts");
const valid = { version: 1, title: "内容复核验收", blocks: [
  { type: "text", content: "标准阶乘 factorial(3) = 6。" },
  { type: "quiz", question: "3! 的结果是多少？", options: ["2", "6"], answer: 1, explanation: "3×2×1=6，所以选择 6。" },
] };
const bad = structuredClone(valid); bad.blocks[1].answer = 0;
const verdict = (doc, issue, uncertain = false) => ({ checks: reviewTargets(doc).map(blockIndex => ({ blockIndex, verdict: issue && blockIndex === 1 ? uncertain ? "uncertain" : "issue" : "pass", reason: issue && blockIndex === 1 ? "答案选择 2，却在解析中得到 6；应选下标 1。" : "本地流程验收。" })) });
assert.deepEqual(factorialFacts({ ...valid, blocks: [{ type: "text", content: "factorial(0)，factorial(3)，5!，-2!，1.5!，101!，factorial(100)" }] }).map(x => [x.n, x.value.length]), [[0, 1], [3, 1], [5, 3], [100, 158]]);
assert.match(factorialFormulaIssue({ ...valid, blocks: [{ type: "formula", latex: "3!=2" }] }), /3! = 6/);
for (const latex of ["0!=1", "3! = 6", "3! = 2+4", "101! = 2", "n! = n(n-1)!"]) assert.equal(factorialFormulaIssue({ ...valid, blocks: [{ type: "formula", latex }] }), null);
assert.equal(factorialFormulaIssue({ ...valid, blocks: [{ type: "text", content: "有人说 3!=2，这是真的吗？" }] }), null, "反例和问题不能被公式规则误判");
assert.equal(factorialFormulaIssue({ ...valid, blocks: [{ type: "formula", latex: "3!=2", caption: "判断这个错误示例" }] }), null);
const factorialCode = { type: "fillBlank", language: "python", text: "def factorial(n):\n    if ___: # 终止点\n        return 1\n    return n * factorial(n - ___)", blanks: [{ options: ["n <= 1", "n > 1"], answer: 0 }, { options: ["1", "0"], answer: 0 }] };
const badPremise = { ...valid.blocks[1], question: "当 factorial(3) 刚刚返回 2 给 factorial(4) 时，哪些帧仍在等待？" };
assert.match(factorialPremiseIssue({ ...valid, blocks: [factorialCode, badPremise] }), /factorial\(3\) 返回 6/);
assert.equal(factorialPremiseIssue({ ...valid, blocks: [badPremise] }), null, "没有可识别实现不能靠名称推定函数行为");
assert.equal(factorialPremiseIssue({ ...valid, blocks: [{ ...factorialCode, text: "def factorial(n):\n    return 2" }, badPremise] }), null, "自定义同名函数不套标准阶乘");
assert.equal(factorialPremiseIssue({ ...valid, blocks: [factorialCode, { type: "text", content: "def factorial(n): return 2" }, badPremise] }), null, "存在多个实现时不能用一个实现解释所有题目");
for (const question of [badPremise.question.replace("返回 2", "返回 6"), "factorial(3) 返回 2 是否正确？"]) assert.equal(factorialPremiseIssue({ ...valid, blocks: [factorialCode, { ...badPremise, question }] }), null);
const partitionDoc = { ...valid, blocks: [{ type: "text", content: "Lomuto：末尾基准，≤ 比较。[3a,1,3b,2]；[5,3a,3b,7,1]；[5,3,8,1,4]" }] };
const partitions = partitionFacts(partitionDoc);
assert.deepEqual(partitions.map(item => item.output), [["1", "2", "3b", "3a"], ["1", "3a", "3b", "7", "5"], ["3", "1", "4", "5", "8"]]);
assert.deepEqual(partitions.map(item => item.pivotIndex), [1, 0, 2]);
assert.deepEqual(partitions[0].swaps, [[0, 1], [1, 3]]);
assert.deepEqual(partitionFacts(valid), []);
assert.deepEqual(partitionFacts({ ...valid, blocks: [{ type: "text", content: "Hoare 首项基准 [3,1,2]" }] }), [], "不把其他分区变体当作同一种算法");
assert.equal(readContentReview(JSON.stringify(verdict(valid)), valid), null);
assert.match(readContentReview(JSON.stringify(verdict(bad, true)), bad), /blocks\[1\]/);
for (const value of [{ checks: [] }, { checks: [verdict(valid).checks[0]] }, { checks: [verdict(valid).checks[0], verdict(valid).checks[0]] }, { ...verdict(valid), ignored: true }, { checks: [{ blockIndex: -1, verdict: "pass", reason: "ok" }, { blockIndex: 99, verdict: "pass", reason: "ok" }] }]) assert.throws(() => readContentReview(JSON.stringify(value), valid), /复核/);
assert.throws(() => readContentReview("not-json", valid), /格式/);
assert.match(teachingContentIssue({ ...valid, blocks: [{ ...valid.blocks[1], options: ["6", " 6 "] }] }), /重复选项/);
const nativeFetch = globalThis.fetch, nativeTimeout = AbortSignal.timeout;
process.env.LLM_BASE_URL = "http://127.0.0.1:3101";
process.env.LLM_API_KEY = "local-test-only";
process.env.LLM_MODEL = "local-test";
let budgetCalls = 0;
try {
  AbortSignal.timeout = ms => { assert.equal(ms, 90000); return nativeTimeout(200); };
  globalThis.fetch = async () => { budgetCalls++; return new Response("temporary", { status: 503 }); };
  await assert.rejects(reviewContent(valid, []), /内容复核超时/);
  assert.equal(budgetCalls, 1, "复核总预算也约束重试退避，不能每次重试重新续期");
} finally { globalThis.fetch = nativeFetch; AbortSignal.timeout = nativeTimeout; }
const { streamExplanation } = await import("../src/lib/api/explanation.ts");
for (const phase of ["build", "review", "repair"]) {
  let resets = 0;
  globalThis.fetch = async () => new Response([
    { type: "stage", stage: phase }, { type: "retry", attempt: 1, message: "重试" }, { type: "done", doc: valid, docId: 1 },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(""));
  try {
    await streamExplanation("generate", {}, { onDelta: () => {}, onReset: () => { resets++; } });
    assert.equal(resets, phase === "build" ? 1 : 0, "复核或后台修复重试不能清空已经生成的正文预览");
  } finally { globalThis.fetch = nativeFetch; }
}

const base = "http://127.0.0.1:3100", model = "http://127.0.0.1:3101";
const configure = body => fetch(model + "/control", { method: "POST", body: JSON.stringify(body) });
const state = async () => (await fetch(model + "/state")).json();
const eventsFrom = text => text.split("\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
let spaceId;
async function run(path, outputs, reviews) {
  await configure({ outputs, reviews });
  const response = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(path === "/api/generate" ? { concept: "阶乘", webSearch: false, spaceId, effort: "low" } : { doc: valid, instruction: "增加练习", effort: "low" }) });
  assert.equal(response.status, 200);
  return { events: eventsFrom(await response.text()), state: await state() };
}
const count = async () => (await (await fetch(`${base}/api/docs?spaceId=${spaceId}`)).json()).docs.length;
const ids = [];
try {
  const response = await fetch(base + "/api/spaces", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: `内容复核验收-${Date.now()}` }) });
  assert(response.ok); ({ id: spaceId } = await response.json());
  for (const path of ["/api/generate", "/api/refine"]) {
    const result = await run(path, [bad, valid], [verdict(bad, true), verdict(valid)]);
    const done = result.events.find(e => e.type === "done"); assert.deepEqual(done?.doc, valid); ids.push(done.docId);
    assert.equal(result.state.reviewRequests.length, 2); assert.equal(result.state.repairRequests.length, 1);
    assert.match(result.state.repairRequests[0].at(-1).content, /下标 1/);
    assert.deepEqual(result.state.requests.map(r => r.effort), ["low", "low", "low", "low"]);
    assert.deepEqual(result.events.filter(e => e.type === "stage").map(e => e.stage), ["build", "verify", "review", "repair", "verify", "review"]);
    const payload = JSON.parse(result.state.reviewRequests[0].at(-1).content);
    assert.deepEqual(payload.standardFactorials, [{ n: 3, value: "6" }]);
    assert.deepEqual(payload.document, bad, "复核看到原始错题，不先改写或只传答案");
  }
  const allTypes = { ...valid, blocks: [...valid.blocks,
    { type: "fillBlank", text: "two ___", blanks: [{ options: ["cats", "cat"], answer: 0 }] },
    { type: "match", prompt: "配对", pairs: [{ left: "栈", right: "后进先出" }, { left: "队列", right: "先进先出" }] },
    { type: "sort", prompt: "分类", categories: ["奇数", "偶数"], items: [{ label: "1", category: "奇数" }] },
  ] };
  const covered = await run("/api/generate", [allTypes]);
  assert.deepEqual(JSON.parse(covered.state.reviewRequests[0].at(-1).content).requiredBlockIndices, [-1, 1, 2, 3, 4]);
  assert(covered.events.some(e => e.type === "done"));
  for (const first of [
    { ...valid, blocks: [{ type: "formula", latex: "3!=2" }, ...valid.blocks] },
    { ...valid, blocks: [factorialCode, badPremise] },
    { ...valid, blocks: [{ ...valid.blocks[1], options: ["6", "6"] }] },
  ]) {
    const repaired = first.blocks.some(block => block.type === "fillBlank") ? { ...valid, blocks: [factorialCode, ...valid.blocks] } : valid;
    const result = await run("/api/generate", [first, repaired]);
    assert(result.events.some(e => e.type === "done"));
    assert.equal(result.state.repairRequests.length, 1); assert.equal(result.state.reviewRequests.length, 1);
  }
  const before = await count();
  for (const reviews of [
    [verdict(bad, true), verdict(bad, true)],
    [verdict(bad, true, true), verdict(bad, true, true)],
    [{ checks: [] }], ["not-json"], [{ status: 401 }],
  ]) {
    const result = await run("/api/generate", [bad, bad], reviews);
    assert(result.events.some(e => e.type === "error")); assert(!result.events.some(e => e.type === "done"));
    assert.equal(await count(), before);
    assert.equal(result.state.repairRequests.length, reviews.length === 2 ? 1 : 0, "复核本身失效不能通过重写讲解掩盖");
  }
  const structural = { ...bad, blocks: [{ type: "formula", latex: "3!=2" }] };
  const shared = await run("/api/generate", [structural, bad], [verdict(bad, true)]);
  assert.equal(shared.state.repairRequests.length, 1); assert(!shared.events.some(e => e.type === "done"));
  assert.equal(await count(), before, "结构和语义不能各自再修一次");
  const removed = await run("/api/generate", [bad, { ...valid, blocks: [valid.blocks[0]] }], [verdict(bad, true)]);
  assert(removed.events.some(e => e.type === "error" && e.message.includes("不得删减")));
  assert(!removed.events.some(e => e.type === "done"));
  assert.equal(removed.state.reviewRequests.length, 1);
  assert.equal(await count(), before, "不能靠删除错题通过复核");
  const deletedAfterArithmetic = await run("/api/generate", [{ ...valid, blocks: [{ type: "formula", latex: "3!=2" }, ...valid.blocks] }, { ...valid, blocks: [valid.blocks[0]] }]);
  assert(deletedAfterArithmetic.events.some(e => e.type === "error" && e.message.includes("不得删减")));
  assert(!deletedAfterArithmetic.events.some(e => e.type === "done"));
  assert.equal(await count(), before, "程序发现的内容问题也必须保留练习数量");

  await configure({ outputs: [valid], reviewDelay: 60000 });
  const controller = new AbortController();
  const pending = fetch(base + "/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ concept: "阶乘", webSearch: false, spaceId }), signal: controller.signal }).then(r => r.text()).catch(e => { assert(controller.signal.aborted); return e.name; });
  const deadline = Date.now() + 5000;
  while (!(await state()).reviewRequests.length) { assert(Date.now() < deadline); await delay(25); }
  controller.abort(); await pending;
  while ((await state()).pending) { assert(Date.now() < deadline); await delay(25); }
  assert((await state()).cancellations >= 1); assert.equal(await count(), before);
  const restarted = await run("/api/generate", [valid]);
  assert(restarted.events.some(e => e.type === "done"), "复核取消后可立即重新生成");

  writeFileSync("data/content-review-fixture.json", JSON.stringify({ spaceId, valid }));
  assert.equal(spawnSync("python", ["test/content-review-ui.py"], { stdio: "inherit" }).status, 0);
  console.log("PASS: content review coverage, exact factorials, semantic repair/recheck, shared repair budget, fail-closed service contract, cancellation and desktop status");
} finally {
  for (const id of ids) await fetch(`${base}/api/docs/${id}`, { method: "DELETE" });
  if (spaceId) await fetch(`${base}/api/spaces/${spaceId}`, { method: "DELETE" });
}
