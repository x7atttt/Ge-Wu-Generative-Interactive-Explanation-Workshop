import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const base = "http://127.0.0.1:3100";
const token = Date.now();
const response = await fetch(base + "/api/spaces", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: `轻量排布验收-${token}` }) });
assert(response.ok);
const { id: spaceId } = await response.json();
let sourceId;
try {
  const form = new FormData();
  form.append("files", new Blob(["队列先进先出。"], { type: "text/plain" }), `待移入资料-${token}.txt`);
  const imported = await fetch(base + "/api/sources", { method: "POST", body: form });
  assert(imported.ok);
  const source = (await imported.json()).sources[0];
  sourceId = source.id;
  const valid = { version: 1, title: "轻量工具栏验收", blocks: [
    { type: "heading", text: "队列与栈", level: 2 },
    { type: "text", content: "队列先进先出，栈后进先出。" },
    { type: "quiz", question: "队列按哪种顺序移除元素？", options: ["先进先出", "后进先出"], answer: 0, explanation: "队列从队头移除元素。" },
  ] };
  const invalid = { ...valid, blocks: [{ ...valid.blocks[2], question: "关于队列，" }] };
  writeFileSync("data/light-toolbar-fixture.json", JSON.stringify({ spaceId, source, valid, invalid, uploadName: `抽屉导入-${token}.txt` }));
  assert.equal(spawnSync("python", ["test/light-toolbar-ui.py"], { stdio: "inherit" }).status, 0);
  console.log("PASS: lightweight toolbar, source drawer import/move/edit, responsive layout, streamed stages, repair and cancellation");
} finally {
  await fetch(`${base}/api/spaces/${spaceId}`, { method: "DELETE" });
  if (sourceId) await fetch(`${base}/api/sources/${sourceId}`, { method: "DELETE" });
}
