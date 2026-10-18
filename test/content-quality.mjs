import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { doc, quiz, fill, chart, code } from "./content-fixture.mjs";
import { studyCards, completeStudyCard, teachingContentIssue, questionIssue } from "../src/lib/study-content.ts";
import { preprocessMarkdown } from "../src/lib/markdown/preprocess.ts";

const base = "http://127.0.0.1:3100";
const created = [];
const fixtureDocs = [];
const db = new DatabaseSync("data/gewu.db");
async function api(path, body, method = body === undefined ? "GET" : "POST", status = 200) {
  const response = await fetch(base + path, { method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const json = await response.json();
  assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(json)}`);
  return json;
}
async function generate(spaceId, outputs) {
  await fetch("http://127.0.0.1:3101/control", { method: "POST", body: JSON.stringify({ outputs }) });
  const response = await fetch(base + "/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ concept: "递归", spaceId, originConcept: "递归", webSearch: false }) });
  return (await response.text()).split("\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));
}
const legacy = (block) => ({ front: block.question, back: `答案：${block.options[block.answer]}\n解析：${block.explanation}` });
try {
  assert.equal(teachingContentIssue(doc), null);
  assert.equal(questionIssue("请选择正确选项："), undefined, "完整的选择题可以使用冒号引出选项");
  assert.match(studyCards({ ...doc, blocks: [{ ...fill, text: fill.text.replaceAll("\n", "<br>") }] })[0].front, /\n    if num == 1:/);
  const candidate = studyCards(doc)[0];
  assert.match(candidate.front, /A\. 5 层[\s\S]*D\. 1 层/);
  assert.match(studyCards(doc)[1].front, /```python\ndef jie_cheng[\s\S]*    else:/);
  assert.match(studyCards(doc)[1].front, /空2选项/);
  assert.equal(completeStudyCard({ ...legacy(quiz), id: 42 }, doc).id, 42);
  assert.equal(completeStudyCard({ front: quiz.question, back: "我的修改" }, doc).back, "我的修改");
  assert.match(preprocessMarkdown("第一行<br>第二行"), /\n/);
  assert.match(preprocessMarkdown("`<br>`"), /`<br>`/);
  const single = { ...doc, blocks: doc.blocks.map((block) => block === chart ? { ...chart, interactionHint: undefined, categories: ["n=1", "n=2"], series: [{ name: "递", data: [{ $var: "depth" }, 2] }, { name: "归", data: [1, 2] }] } : block) };
  assert.match(teachingContentIssue(single), /只有一个数据点/);
  single.blocks.find((block) => block.type === "chart").interactionHint = "仅递系列 n=1 随参数变化，其余固定。";
  assert.equal(teachingContentIssue(single), null);
  const badQuiz = { ...quiz, question: "factorial(5) 的递归过程中，" };
  const badDocs = [
    { ...doc, blocks: [badQuiz] },
    { ...doc, blocks: [{ ...fill, text: "def f(n): if n == 1: return ___ else: return ___" }] },
    { ...doc, blocks: [{ ...fill, text: "def f(n):\nif n == 1:\nreturn ___\nelse:\nreturn ___" }] },
    { ...single, blocks: single.blocks.map((block) => block.type === "chart" ? { ...block, interactionHint: undefined } : block) },
  ];
  const { id: spaceId } = await api("/api/spaces", { name: `内容验收-${Date.now()}` }); created.push(spaceId);
  const { id: badSpace } = await api("/api/spaces", { name: `残缺题验收-${Date.now()}` }); created.push(badSpace);
  const { id: plainSpace } = await api("/api/spaces", { name: `空间删除验收-${Date.now()}` }); created.push(plainSpace);
  const { id: deepSpace } = await api("/api/spaces", { name: `连内容删除验收-${Date.now()}` }); created.push(deepSpace);
  // 每种缺陷都走真实生成管线：首次失败后修复，连续失败不得入库。
  for (const invalid of badDocs) {
    const events = await generate(spaceId, [invalid, doc]);
    assert(events.some((event) => event.type === "done"), JSON.stringify(events));
    assert.equal((await (await fetch("http://127.0.0.1:3101/state")).json()).remaining, 0, "修复请求必须实际消费第二次响应");
    const failed = await generate(spaceId, [invalid, invalid]);
    assert(failed.some((event) => event.type === "error"), JSON.stringify(failed));
    assert(!failed.some((event) => event.type === "done"));
  }
  const rows = (await api(`/api/docs?spaceId=${spaceId}`)).docs;
  assert.equal(rows.length, badDocs.length);
  const docId = rows[0].id;
  const old = legacy(quiz);
  const insert = db.prepare("INSERT INTO cards (space_id, doc_id, origin_concept, front, back, due, repetitions) VALUES (?, ?, ?, ?, ?, date('now','localtime'), ?)");
  const oldId = Number(insert.run(spaceId, docId, "递归", old.front, old.back, 3).lastInsertRowid);
  const extracted = await api("/api/cards/from-doc", { docId });
  assert.deepEqual(extracted, { added: 1, skipped: 1, rejected: 0 });
  assert.equal((await api("/api/cards/from-doc", { docId })).added, 0);
  let cards = (await api(`/api/cards?spaceId=${spaceId}&all=1`)).cards;
  assert.equal(cards.find((card) => card.id === oldId).repetitions, 3);
  assert.match(cards.find((card) => card.id === oldId).front, /D\. 1 层/);
  assert.equal(db.prepare("SELECT front FROM cards WHERE id = ?").get(oldId).front, old.front, "读取兼容不能改写持久化内容");
  const manual = (await api("/api/cards", { spaceId, front: old.front, back: "手写答案", concept: "手写概念" }, "POST", 201)).card;
  assert.equal(manual.front, old.front);
  const editId = Number(insert.run(spaceId, docId, "人工编辑", old.front, "个人解析", 0).lastInsertRowid);
  assert.equal((await api(`/api/cards?spaceId=${spaceId}&all=1`)).cards.find((card) => card.id === editId).back, "个人解析");
  const active = (await api("/api/exams", { spaceId })).session;
  const originalSnapshot = active.cards.map((card) => card.id === oldId ? { ...card, ...old } : card);
  db.prepare("UPDATE exam_sessions SET cards = ? WHERE id = ?").run(JSON.stringify(originalSnapshot), active.id);
  assert.match((await api(`/api/exams/${active.id}`)).session.cards.find((card) => card.id === oldId).front, /D\. 1 层/);
  db.prepare("UPDATE exam_sessions SET completed_at = datetime('now') WHERE id = ?").run(active.id);
  assert.equal((await api(`/api/exams/${active.id}`)).session.cards.find((card) => card.id === oldId).front, old.front, "已完成报告保留历史快照");
  const badDocId = Number(db.prepare("INSERT INTO docs (title, doc, space_id, origin_concept) VALUES (?, ?, ?, ?)").run("历史残缺题", JSON.stringify({ ...doc, blocks: [badQuiz] }), badSpace, "递归").lastInsertRowid);
  const badCardId = Number(insert.run(badSpace, badDocId, "递归", legacy(badQuiz).front, legacy(badQuiz).back, 4).lastInsertRowid);
  assert.equal((await api("/api/cards/from-doc", { docId: badDocId })).rejected, 1);
  await api(`/api/cards/${badCardId}/review`, { grade: "easy" }, "POST", 422);
  const badExam = (await api("/api/exams", { spaceId: badSpace })).session;
  assert(badExam.cards[0].issue);
  await api(`/api/exams/${badExam.id}/answers`, { cardId: badCardId, grade: "easy" }, "POST", 422);
  const afterSkip = (await api(`/api/exams/${badExam.id}/answers`, { cardId: badCardId, grade: "skipped" })).session;
  assert(afterSkip.completedAt);
  assert.equal(db.prepare("SELECT repetitions FROM cards WHERE id = ?").get(badCardId).repetitions, 4);
  assert.equal(db.prepare("SELECT count(*) AS n FROM review_events WHERE card_id = ?").get(badCardId).n, 0);
  // UI fixtures: restored active exam, independent retained/deep deletion records.
  db.prepare("UPDATE exam_sessions SET completed_at = NULL WHERE id = ?").run(active.id);
  db.prepare("DELETE FROM exam_answers WHERE session_id = ?").run(badExam.id);
  db.prepare("UPDATE exam_sessions SET completed_at = NULL WHERE id = ?").run(badExam.id);
  const keepDocs = [plainSpace, deepSpace].map((id) => Number(db.prepare("INSERT INTO docs (title, doc, space_id) VALUES (?, ?, ?)").run(`删除方式验收-${id}`, JSON.stringify(doc), id).lastInsertRowid));
  fixtureDocs.push(...keepDocs);
  const form = new FormData(); form.append("spaceId", String(spaceId)); form.append("files", new Blob(["递归材料"], { type: "text/plain" }), "内容验收.txt");
  const source = (await (await fetch(base + "/api/sources", { method: "POST", body: form })).json()).sources[0];
  const detail = (await api(`/api/sources/${source.id}`)).source;
  await api(`/api/sources/${source.id}`, { revision: detail.revision, concepts: ["递归", "尚未开始", "练习过"] }, "PATCH");
  const learningDoc = Number(db.prepare("INSERT INTO docs (title, doc, space_id, origin_concept) VALUES (?, ?, ?, ?)").run("练习过", JSON.stringify(doc), spaceId, "练习过").lastInsertRowid);
  await api("/api/attempts", { docId: learningDoc, blockType: "quiz", correct: false });
  writeFileSync("data/iteration27-fixture.json", JSON.stringify({ spaceId, badSpace, plainSpace, deepSpace, keepDoc: keepDocs[0], deepDoc: keepDocs[1], docId, oldId, badCardId, sourceId: source.id, code }));
  const result = spawnSync("python", ["test/content-quality-ui.py"], { stdio: "inherit" });
  assert.equal(result.status, 0, "Content browser checks failed");
  console.log("PASS: content generation repair/rejection, card completeness, legacy/manual/snapshot compatibility, invalid-card scheduling invariants");
} finally {
  db.close();
  for (const id of created) await fetch(`${base}/api/spaces/${id}?content=1`, { method: "DELETE" });
  for (const id of fixtureDocs) await fetch(`${base}/api/docs/${id}`, { method: "DELETE" });
  await fetch("http://127.0.0.1:3101/control", { method: "POST", body: JSON.stringify({ outputs: [] }) });
}
