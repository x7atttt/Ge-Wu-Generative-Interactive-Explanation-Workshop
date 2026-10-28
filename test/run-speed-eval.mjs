import "./source-hooks.mjs";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const run = process.argv.find(arg => arg.startsWith("--run="))?.slice(6);
if (!process.argv.includes("--live") || !/^[a-zA-Z0-9_-]+$/.test(run ?? "")) {
  console.log("用法：node test/run-speed-eval.mjs --live --run=唯一名称；一条排序 high，600秒总预算，不联网、不写学习库。"); process.exit(0);
}
const directory = `data/speed-eval/${run}`;
if (existsSync(directory)) throw new Error("同名产物已存在");
process.loadEnvFile(".env.local");
const { generateDoc } = await import("../src/lib/dsl/generate.ts");
const { generateSystemPrompt } = await import("../src/lib/llm/prompts.ts");
mkdirSync(directory, { recursive: true });
const start = performance.now(), now = () => Math.round(performance.now() - start);
const result = { concept: "快速排序的分区过程与稳定性", effort: "high", revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), promptHash: createHash("sha256").update(generateSystemPrompt()).digest("hex"), limitMs: 600000, webSearch: false, firstContentMs: null, stages: [], requests: [], retries: [] };
writeFileSync(`${directory}/prompt.txt`, generateSystemPrompt());
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body), system = body.messages?.[0]?.content ?? "";
  const entry = { atMs: now(), phase: system.startsWith("你是教学内容复核员") ? "review" : system.includes("JSON 修复器") ? "repair" : "generate", effort: body.reasoning_effort, stream: body.stream, status: null };
  result.requests.push(entry);
  const response = await nativeFetch(url, init); entry.status = response.status; entry.headersMs = now(); return response;
};
let raw = "";
console.log(`START ${run}`);
const progress = setInterval(() => console.log(JSON.stringify({ elapsedMs: now(), stage: result.stages.at(-1)?.stage ?? "build", chars: raw.length, requests: result.requests.length })), 20000);
try {
  const doc = await generateDoc(result.concept, { effort: "high", signal: AbortSignal.timeout(600000), onRetry: attempt => { result.retries.push({ attempt, atMs: now() }); raw = ""; } }, text => { if (text.trim()) result.firstContentMs ??= now(); raw += text; }, stage => { result.stages.push({ stage, atMs: now() }); });
  result.success = true; result.characters = JSON.stringify(doc).length; result.blocks = doc.blocks.length;
  writeFileSync(`${directory}/doc.json`, JSON.stringify(doc, null, 2));
} catch (error) {
  result.success = false; result.errorType = error.name;
  result.failure = /超时|时限/.test(error.message) ? "timeout" : /复核|校验/.test(error.message) ? "validation" : "request-failure";
  writeFileSync(`${directory}/raw.txt`, raw);
} finally {
  clearInterval(progress); globalThis.fetch = nativeFetch; result.totalMs = now();
  result.rawCharacters = raw.length; result.requestCount = result.requests.length;
  writeFileSync(`${directory}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
