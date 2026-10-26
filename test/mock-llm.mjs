import { createServer } from "node:http";

let nextDelay = 0;
let pending = false;
let outputs = [];
let calls = 0;
let streamPause = 0;
let repairDelay = 0;
let repairRequests = [];
const doc = { version: 1, title: "验收讲解", blocks: [
  { type: "heading", text: "队列与栈", level: 2 },
  { type: "text", content: "队列先进先出，栈后进先出。" },
  { type: "quiz", question: "队列的顺序？", options: ["先进先出", "后进先出"], answer: 0, explanation: "从队头移除。" },
] };

createServer(async (req, res) => {
  if (req.url === "/health") { res.end("local-test-model"); return; }
  if (req.url === "/state") { res.end(JSON.stringify({ pending, calls, remaining: outputs.length, repairRequests })); return; }
  let raw = "";
  req.setEncoding("utf8");
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  if (req.url === "/control") { nextDelay = body.delay ?? 0; streamPause = body.streamPause ?? 0; repairDelay = body.repairDelay ?? 0; repairRequests = []; if (body.outputs) outputs = body.outputs; res.end("ok"); return; }
  const system = body.messages?.[0]?.content ?? "";
  if (!body.stream && system.includes("JSON 修复器")) repairRequests.push(body.messages);
  calls++;
  const output = JSON.stringify(system.includes("资料分析助手") ? { concepts: ["队列", "栈"] } : system.includes("学习规划师") ? { stages: [{ title: "线性结构", goal: "按顺序理解", concepts: ["队列", "栈"] }] } : outputs.shift() ?? doc);
  if (nextDelay > 0) {
    const delay = nextDelay; nextDelay = 0; pending = true;
    await new Promise((resolve) => setTimeout(resolve, delay));
    pending = false;
  }
  if (body.stream) {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: output } }] })}\n\n`);
    if (streamPause > 0) await new Promise((resolve) => setTimeout(resolve, streamPause));
    res.end("data: [DONE]\n\n");
  } else {
    if (repairDelay > 0) await new Promise((resolve) => setTimeout(resolve, repairDelay));
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { content: output } }] }));
  }
}).listen(3101, "127.0.0.1", () => console.log("Local test model ready"));
