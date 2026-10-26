import { createServer } from "node:http";

let nextDelay = 0;
let pending = false;
let outputs = [];
let calls = 0;
let streamPause = 0;
let repairDelay = 0;
let repairRequests = [];
let requests = [];
let faults = [];
let cancellations = 0;
let epoch = 0;
let active = 0;
const doc = { version: 1, title: "验收讲解", blocks: [
  { type: "heading", text: "队列与栈", level: 2 },
  { type: "text", content: "队列先进先出，栈后进先出。" },
  { type: "quiz", question: "队列的顺序？", options: ["先进先出", "后进先出"], answer: 0, explanation: "从队头移除。" },
] };

createServer(async (req, res) => {
  if (req.url === "/health") { res.end("local-test-model"); return; }
  if (req.url === "/state") { res.end(JSON.stringify({ pending, calls, remaining: outputs.length, repairRequests, requests, cancellations })); return; }
  let raw = "";
  req.setEncoding("utf8");
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  if (req.url === "/control") { epoch++; cancellations = 0; faults = body.faults ?? []; nextDelay = body.delay ?? 0; streamPause = body.streamPause ?? 0; repairDelay = body.repairDelay ?? 0; repairRequests = []; requests = []; if (body.outputs) outputs = body.outputs; res.end("ok"); return; }
  const system = body.messages?.[0]?.content ?? "";
  if (!body.stream && system.includes("JSON 修复器")) repairRequests.push(body.messages);
  calls++;
  requests.push({ effort: body.reasoning_effort ?? null, stream: !!body.stream });
  const requestEpoch = epoch;
  const stopped = new AbortController();
  res.once("close", () => { if (!res.writableFinished) { if (epoch === requestEpoch) cancellations++; stopped.abort(); } });
  const wait = ms => new Promise(resolve => {
    const done = () => { clearTimeout(timer); stopped.signal.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, ms);
    stopped.signal.addEventListener("abort", done, { once: true });
    if (stopped.signal.aborted) done();
  });
  const fault = faults.shift();
  if (fault?.status) { res.writeHead(fault.status, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "temporary test failure" })); return; }
  if (fault?.mode === "drop") { res.destroy(); return; }
  if (fault?.mode === "partial") {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: fault.text ?? '{"version":1,"title":"废弃预览"' } }] })}\n\n`);
    await wait(fault.delay ?? 150);
    if (!stopped.signal.aborted) res.end();
    return;
  }
  active++; pending = true;
  const pause = streamPause, repairPause = repairDelay;
  try {
  const value = system.includes("资料分析助手") ? { concepts: ["队列", "栈"] } : system.includes("学习规划师") ? { stages: [{ title: "线性结构", goal: "按顺序理解", concepts: ["队列", "栈"] }] } : outputs.shift() ?? doc;
  const output = typeof value === "string" ? value : JSON.stringify(value);
  if (nextDelay > 0) {
    const delay = nextDelay; nextDelay = 0;
    await wait(delay);
  }
  if (stopped.signal.aborted) return;
  if (body.stream) {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: output } }] })}\n\n`);
    if (pause > 0) await wait(pause);
    if (stopped.signal.aborted) return;
    res.end("data: [DONE]\n\n");
  } else {
    if (repairPause > 0) await wait(repairPause);
    if (stopped.signal.aborted) return;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { content: output } }] }));
  }
  } finally { active--; pending = active > 0; }
}).listen(3101, "127.0.0.1", () => console.log("Local test model ready"));
