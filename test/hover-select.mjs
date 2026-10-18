import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const base = "http://127.0.0.1:3100";
const created = [];
const token = String(Date.now());
const newName = `菜单新建验收-${token}`;
async function api(path, body, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(base + path, { method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  assert(response.ok, `${method} ${path}: ${response.status}`);
  return response.json();
}
try {
  for (const name of [
    `Alpha 菜单验收-${token}`,
    `算法与数据结构期末复习·递归调用栈、动态规划、图遍历、排序查找与综合练习-${token.slice(-5)}`,
    ...Array.from({ length: 18 }, (_, i) => `菜单滚动验收-${token}-${i + 1}`),
  ]) created.push({ id: (await api("/api/spaces", { name })).id, name });
  writeFileSync("data/iteration29-fixture.json", JSON.stringify({ alpha: created[0], long: created[1], last: created.at(-1), newName }));
  const result = spawnSync("python", ["test/hover-select-ui.py"], { stdio: "inherit" });
  assert.equal(result.status, 0, "悬停下拉浏览器验证失败");
  console.log("PASS: hover selects / real option clicks / keyboard / touch / viewport bounds / persona request & persistence / space create & delete");
} finally {
  const list = (await api("/api/spaces")).spaces;
  for (const space of list) if (space.name === newName) created.push(space);
  for (const space of created) await api(`/api/spaces/${space.id}`, undefined, "DELETE");
}
