import { setPromptSource } from "./source-hooks.mjs";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { teachingCases, inspectTeachingFlow } from "./teaching-cases.mjs";

const args = process.argv.slice(2);
const option = (key, fallback) => args.find(arg => arg.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
if (!args.includes("--live") || args.includes("--help")) {
  console.log("用法：node --experimental-strip-types test/run-teaching-eval.mjs --live --run=my-run [--effort=high] [--case=wave] [--prompt-revision=提交SHA] [--resume]\n显式 --live 才调用已配置的真实模型；串行、有时限、不联网检索、不写学习库。产物仅存 data/teaching-eval/，需要人工核对内容。连续两题失败停止，避免反复消耗额度。");
  process.exit(0);
}
const run = option("run", "");
if (args.some(arg => !["--live", "--resume"].includes(arg) && !/^--(?:run|effort|case|prompt-revision)=/.test(arg))) throw new Error("未知参数，未发起请求");
const effort = option("effort", "high");
const selected = option("case", "all");
const promptRevision = option("prompt-revision", null);
if (promptRevision && !/^[0-9a-f]{7,40}$/.test(promptRevision)) throw new Error("prompt-revision 须为已存在的提交 SHA");
if (!/^[a-zA-Z0-9_-]+$/.test(run) || !["low", "high", "max"].includes(effort)) throw new Error("必须指定安全的 --run 名称和有效的 effort");
const cases = teachingCases.filter(item => selected === "all" || selected.split(",").includes(item.id));
if (!cases.length || (selected !== "all" && selected.split(",").some(id => !teachingCases.some(item => item.id === id)))) throw new Error("未知验收案例");
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
if (!["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"].every(key => process.env[key])) throw new Error("真实模型配置不完整，未发起请求");
const output = resolve("data/teaching-eval", run);
mkdirSync(output, { recursive: true });
let promptUrl = new URL("../src/lib/llm/prompts.ts", import.meta.url).href;
if (promptRevision) {
  const snapshot = resolve(output, `prompts-${promptRevision}.ts`);
  writeFileSync(snapshot, execFileSync("git", ["show", `${promptRevision}:src/lib/llm/prompts.ts`], { encoding: "utf8" }));
  promptUrl = pathToFileURL(snapshot).href;
  setPromptSource(promptUrl);
}
const { generateDoc } = await import("../src/lib/dsl/generate.ts");
const { generateSystemPrompt } = await import(promptUrl);
const manifestPath = resolve(output, "manifest.json");
const promptHash = createHash("sha256").update(generateSystemPrompt()).digest("hex");
const existing = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;
if (existing && (!args.includes("--resume") || existing.promptHash !== promptHash || existing.effort !== effort)) throw new Error("已有验收产物；只有提示词和 effort 相同才能 --resume，请换 run 名称保留对照");
const manifest = existing ?? { run, date: new Date().toISOString(), revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), promptRevision, promptHash, effort, mode: "configured-live", webSearch: false, results: [] };
writeFileSync(resolve(output, "system-prompt.txt"), generateSystemPrompt());
const nativeFetch = globalThis.fetch;
let requests = [];
globalThis.fetch = async (url, init) => {
  // 只记传输次数/状态，不保存地址、请求头、模型配置或思考正文。
  const entry = { stream: !!JSON.parse(init.body).stream, status: null };
  requests.push(entry);
  const response = await nativeFetch(url, init);
  entry.status = response.status;
  return response;
};
let failures = 0;
try {
  for (const item of cases) {
    if (manifest.results.some(result => result.id === item.id)) continue;
    const start = performance.now();
    let firstContentMs = null, raw = "", thinkingObserved = false;
    const stages = [], retries = [];
    requests = [];
    console.log(`START ${item.id}`);
    const progress = setInterval(() => console.log(`WAIT ${item.id} ${Math.round((performance.now() - start) / 1000)}s requests=${requests.length} first=${firstContentMs ?? "none"} chars=${raw.length} stage=${stages.at(-1) ?? "build"} thinking=${thinkingObserved}`), 20_000);
    let result;
    try {
      const doc = await generateDoc(item.concept, {
        effort, sources: item.sources, signal: AbortSignal.timeout(180_000),
        onThinking: () => { thinkingObserved = true; },
        onRetry: attempt => { retries.push({ attempt, stage: stages.at(-1) ?? "build" }); raw = ""; },
      }, delta => {
        if (delta.trim() && firstContentMs === null) firstContentMs = Math.round(performance.now() - start);
        raw += delta;
      }, stage => stages.push(stage));
      result = { id: item.id, concept: item.concept, success: true, firstContentMs, totalMs: Math.round(performance.now() - start), thinkingObserved, requests, stages, retries, flow: inspectTeachingFlow(doc), reviewChecklist: item.review, manualReview: "pending" };
      writeFileSync(resolve(output, `${item.id}.json`), JSON.stringify({ result, doc }, null, 2));
      failures = 0;
    } catch (error) {
      result = { id: item.id, concept: item.concept, success: false, firstContentMs, totalMs: Math.round(performance.now() - start), requests, stages, retries, errorType: error.name, status: error.status ?? null, manualReview: "not-generated" };
      writeFileSync(resolve(output, `${item.id}.json`), JSON.stringify({ result, raw }, null, 2));
      failures++;
    } finally { clearInterval(progress); }
    manifest.results.push(result);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`${result.success ? "PASS" : "FAIL"} ${item.id} first=${result.firstContentMs ?? "none"}ms total=${result.totalMs}ms requests=${requests.length} repair=${stages.includes("repair")}`);
    if (failures >= 2) { console.log("STOP: 连续两题失败，请先检查模型服务；剩余案例未执行。"); break; }
  }
} finally { globalThis.fetch = nativeFetch; }
if (manifest.results.some(result => !result.success) || cases.some(item => !manifest.results.some(result => result.id === item.id))) process.exitCode = 1;
