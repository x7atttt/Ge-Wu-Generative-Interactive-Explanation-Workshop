import assert from "node:assert/strict";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { chat, streamChat } from "../src/lib/llm/client.ts";
import { sseResponse } from "../src/lib/api/sse.ts";
import { tryAcquireAction, currentAction } from "../src/lib/actionGuard.ts";

let modes = [], calls = 0, disconnected = 0;
const server = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  calls++;
  const mode = modes.shift() ?? "ok";
  const closed = new AbortController();
  res.once("close", () => { if (!res.writableFinished) { disconnected++; closed.abort(); } });
  const pause = ms => delay(ms, undefined, { signal: closed.signal }).catch(() => {});
  if (typeof mode === "number") { res.writeHead(mode); res.end("test status"); return; }
  if (mode === "drop") { res.destroy(); return; }
  if (mode === "stall") { res.flushHeaders(); await pause(60000); return; }
  if (!body.stream) {
    res.setHeader("Content-Type", "application/json");
    if (mode === "body-stall") { res.write('{"choices":['); await pause(60000); return; }
    res.end(JSON.stringify({ choices: [{ message: { content: "完整结果" } }] })); return;
  }
  res.setHeader("Content-Type", "text/event-stream");
  if (mode === "slow-content") {
    for (const text of ["完", "整", "结", "果"]) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
      await pause(200);
    }
    res.end("data: [DONE]\n\n");
    return;
  }
  if (["heartbeat-only", "reasoning-only", "whitespace-only", "content-stall", "endless-content"].includes(mode)) {
    if (mode === "content-stall") res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "废弃片段" } }] })}\n\n`);
    while (!closed.signal.aborted) {
      const delta = mode === "reasoning-only" ? { reasoning_content: "private test reasoning" } : { content: mode === "endless-content" ? "持续返回但不结束的正文。" : " \n" };
      res.write(mode === "heartbeat-only" || mode === "content-stall" ? ": keepalive\n\n" : `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
      await pause(20);
    }
    return;
  }
  if (mode === "thinking") {
    for (let i = 0; i < 5; i++) { res.write(": keepalive\n\n"); await pause(150); }
  }
  const text = mode === "partial" ? "废弃片段" : "完整结果";
  if (mode !== "empty") res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\r\n\r\n`);
  if (mode === "partial") { res.end(); return; }
  res.end("data: [DONE]\r\n\r\n");
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
process.env.LLM_BASE_URL = `http://127.0.0.1:${server.address().port}`;
process.env.LLM_API_KEY = "local-test-only";
process.env.LLM_MODEL = "local-test";
const messages = [{ role: "user", content: "测试" }];
const configure = value => { modes = value; calls = 0; };
const waitFor = async predicate => {
  const end = Date.now() + 2000;
  while (!predicate()) { assert(Date.now() < end, "等待超时"); await delay(10); }
};
try {
  for (const faults of [[503, 502], ["drop", "drop"], ["empty", "empty"], ["stall", "stall"]]) {
    configure([...faults, "ok"]);
    const retries = [];
    assert.equal(await streamChat(messages, { idleTimeoutMs: 500, onRetry: n => retries.push(n) }, () => {}), "完整结果");
    assert.equal(calls, 3);
    assert.deepEqual(retries, [1, 2]);
  }
  configure([503, 503, 503, "ok"]);
  await assert.rejects(streamChat(messages, {}, () => {}), /503/);
  assert.equal(calls, 3, "重试有上限");
  configure([401, "ok"]);
  await assert.rejects(streamChat(messages, {}, () => {}), /401/);
  assert.equal(calls, 1, "鉴权错误不重试");
  configure(["partial", "ok"]);
  let preview = "";
  assert.equal(await streamChat(messages, { onRetry: () => { preview = ""; } }, t => { preview += t; }), "完整结果");
  assert.equal(preview, "完整结果", "重启流前必须清空旧片段");
  configure(["partial", "ok"]);
  await assert.rejects(streamChat(messages, {}, () => {}), /尚未完成/);
  assert.equal(calls, 1, "没有重置回调时不能拼接部分响应");
  configure(["thinking"]);
  assert.equal(await streamChat(messages, { idleTimeoutMs: 500 }, () => {}), "完整结果");
  assert.equal(calls, 1, "正常返回心跳的高强度思考不重启");

  for (const mode of ["heartbeat-only", "reasoning-only", "whitespace-only", "content-stall"]) {
    configure([mode, "ok"]);
    let result = "", thinking = 0;
    const retries = [], before = disconnected;
    assert.equal(await streamChat(messages, {
      signal: AbortSignal.timeout(5000), firstContentTimeoutMs: 500, idleTimeoutMs: 1000,
      onThinking: () => thinking++, onRetry: n => { retries.push(n); result = ""; },
    }, t => { result += t; }), "完整结果");
    assert.equal(result, "完整结果");
    assert.deepEqual(retries, [1], `${mode} 不能用心跳无限续期`);
    assert.equal(thinking, mode === "reasoning-only" ? 1 : 0, "只通知思考状态，不泄露思考正文或重复刷屏");
    await waitFor(() => disconnected > before);
  }
  configure(["heartbeat-only", "reasoning-only", "heartbeat-only", "ok"]);
  await assert.rejects(streamChat(messages, {
    signal: AbortSignal.timeout(5000), firstContentTimeoutMs: 300, onRetry: () => {},
  }, () => {}), /未返回正文/);
  assert.equal(calls, 3, "正文超时最多重试两次，随后明确失败");
  configure(["slow-content"]);
  assert.equal(await streamChat(messages, { firstContentTimeoutMs: 400, idleTimeoutMs: 500 }, () => {}), "完整结果");
  assert.equal(calls, 1, "正常流式正文可持续续期，不按总生成时长误杀");
  configure(["endless-content", "ok"]);
  const beforeEndless = disconnected;
  let endlessRetries = 0;
  await assert.rejects(streamChat(messages, { streamTimeoutMs: 500, idleTimeoutMs: 1000, onRetry: () => endlessRetries++ }, () => {}), /超过总时限/);
  assert.equal(calls, 1, "持续循环输出到总时限后直接结束，不自动重跑循环");
  assert.equal(endlessRetries, 0);
  await waitFor(() => disconnected > beforeEndless);

  for (const [stream, mode] of [[true, "stall"], [true, "reasoning-only"], [false, "body-stall"]]) {
    configure([mode]);
    const controller = new AbortController();
    const before = disconnected;
    const promise = stream ? streamChat(messages, { signal: controller.signal }, () => {}) : chat(messages, { signal: controller.signal });
    const rejected = assert.rejects(promise, error => error.name === "AbortError");
    await waitFor(() => calls === 1);
    controller.abort();
    await rejected;
    await waitFor(() => disconnected > before);
    assert.equal(calls, 1, "用户取消不触发重试");
  }
  configure([503, "ok"]);
  const backoff = new AbortController();
  await assert.rejects(streamChat(messages, { signal: backoff.signal, onRetry: () => backoff.abort() }, () => {}), error => error.name === "AbortError");
  assert.equal(calls, 1, "重试间隔也可取消");
  configure([503, 502, "ok"]);
  assert.equal(await chat(messages), "完整结果");
  assert.equal(calls, 3, "非流式修复也支持两次网络重试");
  configure(["ok", "ok"]);
  await assert.rejects(streamChat(messages, {}, () => { throw new TypeError("调用方已停止"); }), /调用方已停止/);
  assert.equal(calls, 1, "回调异常不能被 JSON 解析捕获吞掉");

  const releaseOld = tryAcquireAction("generate");
  assert(releaseOld);
  assert.equal(tryAcquireAction("refine"), null);
  releaseOld();
  const releaseNew = tryAcquireAction("refine");
  releaseOld();
  assert.equal(currentAction(), "refine", "旧任务的 finally 不能解锁新任务");
  releaseNew();
  let producerStopped = false;
  const release = tryAcquireAction("generate");
  const response = sseResponse(async (_send, signal) => {
    await delay(60000, undefined, { signal }).catch(() => {});
    producerStopped = signal.aborted;
  }, undefined, release);
  await response.body.cancel();
  await waitFor(() => producerStopped);
  assert.equal(currentAction(), null, "响应流取消时立即释放单飞门");
  console.log("PASS: bounded retries, status classification, idle/heartbeat, partial reset, user cancellation, non-stream cancellation, callback errors, response cancellation and lock ownership");
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
