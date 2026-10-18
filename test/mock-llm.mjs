import { createServer } from "node:http";

let nextDelay = 0;
let pending = false;
const doc = { version: 1, title: "验收讲解", blocks: [
  { type: "heading", text: "队列与栈", level: 2 },
  { type: "text", content: "队列先进先出，栈后进先出。" },
  { type: "quiz", question: "队列的顺序？", options: ["先进先出", "后进先出"], answer: 0, explanation: "从队头移除。" },
] };

createServer(async (req, res) => {
  if (req.url === "/health") { res.end("local-test-model"); return; }
  if (req.url === "/state") { res.end(JSON.stringify({ pending })); return; }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  if (req.url === "/control") { nextDelay = body.delay; res.end("ok"); return; }
  const system = body.messages?.[0]?.content ?? "";
  const output = JSON.stringify(system.includes("资料分析助手") ? { concepts: ["队列", "栈"] } : system.includes("学习规划师") ? { stages: [{ title: "线性结构", goal: "按顺序理解", concepts: ["队列", "栈"] }] } : doc);
  if (nextDelay > 0) {
    const delay = nextDelay; nextDelay = 0; pending = true;
    await new Promise((resolve) => setTimeout(resolve, delay));
    pending = false;
  }
  if (body.stream) {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: output } }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  } else {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { content: output } }] }));
  }
}).listen(3101, "127.0.0.1", () => console.log("Local test model ready"));
