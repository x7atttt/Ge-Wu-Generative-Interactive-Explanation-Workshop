import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { doc } from "./content-fixture.mjs";

const base = "http://127.0.0.1:3100";
const db = new DatabaseSync("data/gewu.db");
const created = [];
async function api(path, body, method = body === undefined ? "GET" : "POST", status = 200) {
  const response = await fetch(base + path, { method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const json = await response.json().catch(() => null);
  assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(json)}`);
  return json;
}
async function fixture(label) {
  const name = `删除同步验收-${label}-${Date.now()}`;
  const { id } = await api("/api/spaces", { name }); created.push(id);
  const form = new FormData(); form.append("spaceId", String(id)); form.append("files", new Blob(["递归的调用与返回"], { type: "text/plain" }), `${name}.txt`);
  const source = (await (await fetch(base + "/api/sources", { method: "POST", body: form })).json()).sources[0];
  const detail = (await api(`/api/sources/${source.id}`)).source;
  await api(`/api/sources/${source.id}`, { revision: detail.revision, concepts: [name] }, "PATCH");
  const insert = db.prepare("INSERT INTO docs (parent_id, title, doc, space_id, origin_concept, source_ids) VALUES (?, ?, ?, ?, ?, ?)");
  const docTitle = `${name}的讲解`;
  const rootId = Number(insert.run(null, docTitle, JSON.stringify({ ...doc, title: docTitle }), id, name, JSON.stringify([source.id])).lastInsertRowid);
  const childTitle = `${name}的深化`;
  const childId = Number(insert.run(rootId, childTitle, JSON.stringify({ ...doc, title: childTitle }), id, name, JSON.stringify([source.id])).lastInsertRowid);
  db.prepare("INSERT INTO asks (doc_id, role, content) VALUES (?, 'user', '继续解释')").run(childId);
  await api("/api/attempts", { docId: rootId, blockType: "quiz", correct: true });
  await api("/api/cards/from-doc", { docId: rootId });
  await api("/api/cards", { spaceId: id, front: "手写测试", back: "答案" }, "POST", 201);
  const cards = (await api(`/api/cards?spaceId=${id}&all=1`)).cards;
  await api(`/api/cards/${cards[0].id}/review`, { grade: "easy" });
  const session = (await api("/api/exams", { spaceId: id })).session;
  await api(`/api/exams/${session.id}/answers`, { cardId: session.cards[0].id, grade: "easy" });
  return { id, name, rootId, childId, docTitle, childTitle, sourceId: source.id, sourceTitle: source.title, cardIds: cards.map((card) => card.id), sessionId: session.id };
}
function counts(f) {
  const n = (sql, ...args) => db.prepare(sql).get(...args).n;
  const marks = f.cardIds.map(() => "?").join(",");
  return {
    spaces: n("SELECT count(*) AS n FROM spaces WHERE id = ?", f.id),
    sources: n("SELECT count(*) AS n FROM sources WHERE id = ?", f.sourceId),
    docs: n("SELECT count(*) AS n FROM docs WHERE id IN (?, ?)", f.rootId, f.childId),
    asks: n("SELECT count(*) AS n FROM asks WHERE doc_id IN (?, ?)", f.rootId, f.childId),
    attempts: n("SELECT count(*) AS n FROM attempts WHERE doc_id IN (?, ?)", f.rootId, f.childId),
    cards: n("SELECT count(*) AS n FROM cards WHERE space_id = ?", f.id),
    reviews: n(`SELECT count(*) AS n FROM review_events WHERE card_id IN (${marks})`, ...f.cardIds),
    sessions: n("SELECT count(*) AS n FROM exam_sessions WHERE space_id = ?", f.id),
    answers: n("SELECT count(*) AS n FROM exam_answers WHERE session_id = ?", f.sessionId),
  };
}
try {
  const current = await fixture("管理面板当前");
  const other = await fixture("管理面板其他");
  const toolbar = await fixture("工具条");
  const missing = await fixture("失效选择");
  const late = await fixture("延迟讲解");
  const rollback = await fixture("事务回滚");
  const before = counts(rollback);
  assert(Object.values(before).every((value) => value > 0), JSON.stringify(before));
  db.exec(`CREATE TRIGGER iteration28_delete_failure BEFORE DELETE ON sources WHEN OLD.id = ${rollback.sourceId} BEGIN SELECT RAISE(ABORT, 'iteration28 rollback test'); END;`);
  await api(`/api/spaces/${rollback.id}`, undefined, "DELETE", 500);
  assert.deepEqual(counts(rollback), before, "中途失败必须回滚所有删除");
  db.exec("DROP TRIGGER iteration28_delete_failure");
  const deleted = await api(`/api/spaces/${rollback.id}`, undefined, "DELETE");
  assert.deepEqual(new Set(deleted.docIds), new Set([rollback.rootId, rollback.childId]));
  assert.deepEqual(deleted.sourceIds, [rollback.sourceId]);
  assert(Object.values(counts(rollback)).every((value) => value === 0));
  assert.deepEqual((await api(`/api/spaces/${rollback.id}`, undefined, "DELETE")).docIds, []);
  const untouched = counts(other);
  writeFileSync("data/iteration28-fixture.json", JSON.stringify({ current, other, toolbar, missing, late }));
  const result = spawnSync("python", ["test/space-deletion-ui.py"], { stdio: "inherit" });
  assert.equal(result.status, 0, "空间删除浏览器回归失败");
  for (const f of [current, other, toolbar, missing, late]) assert(Object.values(counts(f)).every((value) => value === 0), `仍有残留 ${f.name}: ${JSON.stringify(counts(f))}`);
  assert(untouched.docs === 2 && untouched.cards === 3, "其他空间的基线夹具必须完整");
  console.log("PASS: default deep deletion, all related rows removed, transaction rollback, idempotency, browser stale-response recovery");
} finally {
  db.exec("DROP TRIGGER IF EXISTS iteration28_delete_failure");
  db.close();
  for (const id of created) await fetch(`${base}/api/spaces/${id}`, { method: "DELETE" });
}
