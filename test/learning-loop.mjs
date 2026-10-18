import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const base = "http://127.0.0.1:3100";
const created = [];
let checks = 0;
async function api(path, body, method = body === undefined ? "GET" : "POST", status = 200) {
  const res = await fetch(base + path, { method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const data = await res.json();
  assert.equal(res.status, status, `${method} ${path}: ${JSON.stringify(data)}`); checks++;
  return data;
}
async function generate(body, route = "generate") {
  const res = await fetch(`${base}/api/${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal(res.status, 200);
  const events = (await res.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
  assert(!events.some((e) => e.type === "error"), JSON.stringify(events));
  const done = events.find((e) => e.type === "done"); assert(done); checks++;
  return done;
}

let db;
try {
  assert.equal(await (await fetch("http://127.0.0.1:3101/health")).text(), "local-test-model");
  const { id } = await api("/api/spaces", { name: `一次性验收-${Date.now()}` }); created.push(id);
  const empty = await api("/api/spaces", { name: `一次性空空间-${Date.now()}` }); created.push(empty.id);
  const form = new FormData(); form.append("spaceId", String(id)); form.append("files", new Blob(["队列先进先出。栈后进先出。"], { type: "text/plain" }), "验收资料.txt");
  const imported = await (await fetch(base + "/api/sources", { method: "POST", body: form })).json();
  const sourceId = imported.sources[0].id;
  const source = (await api(`/api/sources/${sourceId}`)).source;
  await api(`/api/sources/${sourceId}`, { revision: source.revision, concepts: ["队列", "栈"] }, "PATCH");
  const root = await generate({ concept: "队列", originConcept: "队列", spaceId: id, sourceIds: [sourceId], webSearch: false });
  const original = await api(`/api/docs/${root.docId}`);
  assert.match(original.sourceContext.text, /先进先出/);
  await api("/api/attempts", { docId: root.docId, blockType: "quiz", correct: false });
  let map = await api(`/api/spaces/${id}/map`);
  assert.equal(map.concepts.find((c) => c.text === "队列").status, "learning");
  for (let n = 0; n < 2; n++) await api("/api/attempts", { docId: root.docId, blockType: "quiz", correct: true });
  map = await api(`/api/spaces/${id}/map`);
  assert.equal(map.concepts.find((c) => c.text === "队列").status, "practiced");
  for (let n = 0; n < 2; n++) await api("/api/attempts", { docId: root.docId, blockType: "quiz", correct: false });
  assert.equal((await api(`/api/spaces/${id}/map`)).concepts.find((c) => c.text === "队列").status, "weak");
  for (let n = 0; n < 4; n++) await api("/api/attempts", { docId: root.docId, blockType: "quiz", correct: true });
  assert.equal((await api(`/api/spaces/${id}/map`)).concepts.find((c) => c.text === "队列").status, "practiced");
  const a = (await api("/api/cards", { spaceId: id, front: "队列首元素从哪里出？", back: "队头", concept: "队列" }, "POST", 201)).card;
  const b = (await api("/api/cards", { spaceId: id, front: "栈从哪里出？", back: "栈顶", concept: "栈" }, "POST", 201)).card;
  const session = (await api("/api/exams", { spaceId: id })).session;
  assert.equal((await api("/api/exams", { spaceId: id })).session.id, session.id);
  const first = session.cards[0]; const second = session.cards[1];
  await api(`/api/exams/${session.id}/answers`, { cardId: second.id, grade: "easy" }, "POST", 409);
  await api(`/api/exams/${session.id}/answers`, { cardId: first.id, grade: "again" });
  const before = (await api(`/api/cards?spaceId=${id}&all=1`)).cards.find((c) => c.id === first.id);
  await Promise.all([api(`/api/exams/${session.id}/answers`, { cardId: first.id, grade: "again" }), api(`/api/exams/${session.id}/answers`, { cardId: first.id, grade: "again" })]);
  const after = (await api(`/api/cards?spaceId=${id}&all=1`)).cards.find((c) => c.id === first.id);
  assert.equal(after.repetitions, before.repetitions);
  await api(`/api/exams/${session.id}/answers`, { cardId: first.id, grade: "easy" }, "POST", 409);
  assert.equal(Object.keys((await api(`/api/exams/${session.id}`)).session.answers).length, 1);
  await api(`/api/exams/${session.id}/answers`, { cardId: second.id, grade: "easy" });
  assert((await api(`/api/exams/${session.id}`)).session.completedAt);
  map = await api(`/api/spaces/${id}/map`);
  assert.equal(map.concepts.find((c) => c.text === first.originConcept).recall.again, 1);
  await api(`/api/cards/${first.id}/review`, { grade: "easy" });
  map = await api(`/api/spaces/${id}/map`);
  assert.equal(map.concepts.find((c) => c.text === first.originConcept).recall.again, 0);
  const src = (await api(`/api/sources/${sourceId}`)).source;
  await fetch('http://127.0.0.1:3101/control', { method: 'POST', body: JSON.stringify({ delay: 800 }) });
  const racingRoadmap = api(`/api/spaces/${id}/roadmap`, {}, 'POST', 409);
  let modelPending = false;
  for (let i = 0; i < 100; i++) {
    if ((await (await fetch('http://127.0.0.1:3101/state')).json()).pending) { modelPending = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert(modelPending, '本地模型未进入延迟阶段，并发验证无效');
  await api(`/api/sources/${sourceId}`, { revision: src.revision, concepts: ['队列', '栈', '新概念'] }, 'PATCH');
  await racingRoadmap;
  const raceSource = (await api(`/api/sources/${sourceId}`)).source;
  db = new DatabaseSync("data/gewu.db");
  db.prepare("UPDATE spaces SET roadmap = ?, roadmap_stale = 0 WHERE id = ?").run(JSON.stringify({ stages: [{ title: "线性结构", goal: "按顺序理解", concepts: ["队列", "栈"] }] }), id);
  await api(`/api/sources/${sourceId}`, { revision: raceSource.revision, mdContent: "修正正文：队列从队头移除。" }, "PATCH");
  assert.deepEqual((await api(`/api/sources/${sourceId}`)).source.concepts, []);
  assert((await api(`/api/spaces/${id}/map`)).space.roadmapStale);
  await api(`/api/sources/${sourceId}`, { revision: src.revision, concepts: ["过期修改"] }, "PATCH", 409);
  const corrected = (await api(`/api/sources/${sourceId}`)).source;
  await api(`/api/sources/${sourceId}`, { revision: corrected.revision, concepts: ["队列", "栈"] }, "PATCH");
  assert.deepEqual((await api(`/api/docs/${root.docId}`)).sourceContext, original.sourceContext);
  const refined = await generate({ docId: root.docId, doc: root.doc, instruction: "补一个例子" }, "refine");
  assert.deepEqual((await api(`/api/docs/${refined.docId}`)).sourceContext, original.sourceContext);
  const legacy = db.prepare("INSERT INTO docs (title, doc, space_id) VALUES (?, ?, ?)").run("旧讲解", JSON.stringify(root.doc), id);
  assert.equal((await api(`/api/docs/${legacy.lastInsertRowid}`)).sourceContext, null);
  db.prepare("UPDATE sources SET status = 'parsing' WHERE id = ?").run(sourceId);
  await api(`/api/sources/${sourceId}`, { revision: corrected.revision + 1, concepts: ['队列'] }, 'PATCH', 409);
  db.prepare("UPDATE sources SET status = 'ready' WHERE id = ?").run(sourceId);
  await api('/api/sources/0', undefined, 'GET', 400);
  await api('/api/sources/999999999', undefined, 'GET', 404);
  await api(`/api/sources/${sourceId}`, null, "PATCH", 400);
  await api(`/api/sources/${sourceId}`, { revision: corrected.revision + 1, mdContent: " " }, "PATCH", 400);
  await api(`/api/exams?spaceId=0`, undefined, "GET", 400);
  await api(`/api/exams/missing/answers`, { cardId: a.id, grade: "easy" }, "POST", 404);
  const deletedSession = (await api("/api/exams", { spaceId: id })).session;
  const removed = deletedSession.cards[0];
  await api(`/api/cards/${removed.id}`, undefined, "DELETE");
  await api(`/api/exams/${deletedSession.id}/answers`, { cardId: removed.id, grade: "easy" }, "POST", 410);
  await api(`/api/exams/${deletedSession.id}/answers`, { cardId: removed.id, grade: "skipped" });
  const remaining = deletedSession.cards[1];
  await api(`/api/exams/${deletedSession.id}/answers`, { cardId: remaining.id, grade: "skipped" }, "POST", 409);
  await api(`/api/exams/${deletedSession.id}/answers`, { cardId: remaining.id, grade: "easy" });
  await api("/api/cards/from-doc", { docId: root.docId });
  await api(`/api/cards/${remaining.id}/review`, { grade: "again" });
  writeFileSync("data/iteration26-fixture.json", JSON.stringify({ spaceId: id, emptyId: empty.id, sourceId, docId: root.docId, a: a.id, b: b.id, remaining: remaining.id }));
  if (process.argv.includes("--browser")) {
    const result = spawnSync("python", ["test/learning-loop-ui.py"], { stdio: "inherit" });
    assert.equal(result.status, 0, "Browser verification failed");
  }
  console.log(`PASS: ${checks} API assertions + state / snapshot / idempotency invariants`);
} finally {
  db?.close();
  if (!process.argv.includes("--keep")) for (const id of created) await api(`/api/spaces/${id}?content=1`, undefined, "DELETE");
}
