import "./source-hooks.mjs";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const option = (key, fallback) => args.find(arg => arg.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
if (!args.includes("--live") || args.includes("--help")) {
  console.log("用法：node test/run-content-review-eval.mjs --live --run=my-run [--effort=low] [--case=sorting] [--repair-recursion]\n默认复核上一轮递归/排序错题与波形/语言对照，复核固定 low；effort 仅用于 --repair-recursion 的修复请求。均不写学习库。结果不代表总体准确率。");
  process.exit(0);
}
if (args.some(arg => !["--live", "--repair-recursion"].includes(arg) && !/^--(?:run|effort|case)=/.test(arg))) throw new Error("未知参数");
const repairReplay = args.includes("--repair-recursion");
const run = option("run", ""), effort = option("effort", "low");
if (!/^[a-zA-Z0-9_-]+$/.test(run) || !["low", "high", "max"].includes(effort)) throw new Error("run 或 effort 不合法");
const output = resolve("data/content-review-eval", run);
if (existsSync(output)) throw new Error("已有同名产物，请换名称保留记录");
const { reviewContent, factorialFormulaIssue, factorialPremiseIssue, CONTENT_REVIEW_PROMPT } = await import("../src/lib/dsl/content-review.ts");
const { generateSystemPrompt } = await import("../src/lib/llm/prompts.ts");
const { generateDoc } = await import("../src/lib/dsl/generate.ts");
const examples = generateSystemPrompt().split(/示例[A-Z][^\n]*\n/).slice(1).map(text => JSON.parse(text.trim()));
const cases = (repairReplay ? ["recursion"] : ["recursion", "sorting"]).map(id => ({ id, expected: "issue", doc: JSON.parse(readFileSync(`data/teaching-eval/final-low-20261027/${id}.json`, "utf8")).doc }));
if (!repairReplay) cases.push(...examples.map((doc, index) => ({ id: index === 0 ? "wave-control" : "grammar-control", expected: "no-known-issue", doc })));
const selected = option("case", "all");
const work = cases.filter(item => selected === "all" || item.id === selected);
if (!work.length) throw new Error("未知案例，未调用模型");
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
if (!["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"].every(key => process.env[key])) throw new Error("真实模型配置不完整");
mkdirSync(output, { recursive: true });
const manifest = { run, date: new Date().toISOString(), mode: repairReplay ? "repair-replay" : "review", effort, reviewEffort: "low", revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), reviewPromptHash: createHash("sha256").update(CONTENT_REVIEW_PROMPT).digest("hex"), results: [] };
writeFileSync(resolve(output, "review-prompt.txt"), CONTENT_REVIEW_PROMPT);
const nativeFetch = globalThis.fetch;
let requests = [], responses = [], replayDocument;
globalThis.fetch = async (url, init) => {
  if (replayDocument) {
    const doc = replayDocument; replayDocument = null;
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(doc) } }] })}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
  }
  const entry = { status: null, effort: JSON.parse(init.body).reasoning_effort }; requests.push(entry);
  const response = await nativeFetch(url, init); entry.status = response.status;
  if (response.ok) { const value = await response.clone().json(); responses.push(value.choices?.[0]?.message?.content ?? null); }
  return response;
};
let consecutiveFailures = 0;
try {
  for (const item of work) {
    requests = []; responses = [];
    const start = performance.now();
    const progress = setInterval(() => console.log(`WAIT ${item.id} ${Math.round((performance.now() - start) / 1000)}s requests=${requests.length}`), 20000);
    console.log(`START ${item.id}`);
    let result, repairedDoc;
    try {
      if (repairReplay) {
        replayDocument = item.doc;
        const stages = [];
        repairedDoc = await generateDoc(item.doc.title, { effort, signal: AbortSignal.timeout(600000) }, () => {}, stage => stages.push(stage));
        result = { id: item.id, completed: true, check: "repair-replay", stages, totalMs: Math.round(performance.now() - start), requests, manualReview: "pending" };
      } else {
        const deterministicIssue = factorialFormulaIssue(item.doc) ?? factorialPremiseIssue(item.doc);
        const issue = deterministicIssue ?? await reviewContent(item.doc, [{ role: "user", content: `概念：${item.doc.title}` }], { signal: AbortSignal.timeout(600000) });
        result = { id: item.id, expected: item.expected, completed: true, issue, check: deterministicIssue ? "deterministic" : "model", totalMs: Math.round(performance.now() - start), requests };
      }
      consecutiveFailures = 0;
    } catch (error) {
      result = { id: item.id, expected: item.expected, completed: false, error: error.message, totalMs: Math.round(performance.now() - start), requests };
      consecutiveFailures++;
    } finally { clearInterval(progress); }
    manifest.results.push(result);
    writeFileSync(resolve(output, `${item.id}.json`), JSON.stringify({ result, doc: item.doc, repairedDoc, responses }, null, 2));
    writeFileSync(resolve(output, "manifest.json"), JSON.stringify(manifest, null, 2));
    console.log(`${result.completed ? result.issue ? "FLAGGED" : "CLEAR" : "FAILED"} ${item.id} ${result.totalMs}ms requests=${requests.length}`);
    if (consecutiveFailures >= 2) { console.log("STOP: 连续两项复核服务失败，剩余未执行"); break; }
  }
} finally { globalThis.fetch = nativeFetch; }
