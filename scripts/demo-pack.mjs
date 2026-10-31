import { registerHooks } from "node:module";
import { extname, resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { backup } from "node:sqlite";
import { z } from "zod";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = pathToFileURL(`${root}/src/`).href;
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) specifier = new URL(`${specifier.slice(2)}.ts`, sourceRoot).href;
  else if (context.parentURL?.startsWith(sourceRoot) && specifier.startsWith(".") && !extname(specifier)) specifier += ".ts";
  return next(specifier, context);
} });
const { explainDocSchema, validateDoc } = await import("../src/lib/dsl/schema.ts");
const { getDb } = await import("../src/lib/db/index.ts");
const key = z.string().regex(/^[a-zA-Z0-9_-]+$/);
const bundleSchema = z.object({
  format: z.literal(1), id: key, name: z.string().min(1).max(40),
  provenance: z.string().min(1).max(100),
  sources: z.array(z.object({ key, title: z.string().min(1), markdown: z.string().min(1), concepts: z.array(z.string().min(1)) }).strict()),
  lessons: z.array(z.object({ key, parent: key.nullable(), instruction: z.string().nullable(), concept: z.string().min(1), sources: z.array(key), doc: explainDocSchema }).strict()).min(1),
  roadmap: z.array(z.object({ title: z.string().min(1), goal: z.string().min(1), concepts: z.array(z.string().min(1)).min(1) }).strict()),
}).strict();

function validate(raw) {
  const pack = bundleSchema.parse(raw);
  const sources = new Set(), lessons = new Set();
  for (const source of pack.sources) {
    if (sources.has(source.key)) throw new Error("资料 key 重复");
    sources.add(source.key);
  }
  const concepts = new Set(pack.sources.flatMap(s => s.concepts));
  for (const [index, lesson] of pack.lessons.entries()) {
    if (lessons.has(lesson.key) || (lesson.parent && !lessons.has(lesson.parent))) throw new Error("讲解 key 重复，或父版本未先出现");
    if (lesson.sources.some(k => !sources.has(k))) throw new Error("资料关联不存在");
    if (lesson.sources.length && !lesson.sources.some(k => pack.sources.find(s => s.key === k).concepts.includes(lesson.concept))) throw new Error("讲解概念不在关联资料中");
    const error = validateDoc(raw.lessons[index].doc, { rejectUnknownFields: true });
    if (error) throw new Error(error);
    lessons.add(lesson.key);
  }
  if (pack.roadmap.some(s => s.concepts.some(c => !concepts.has(c)))) throw new Error("路线概念不在资料中");
  return pack;
}

const [command, ...args] = process.argv.slice(2);
const option = name => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const packFile = resolve(option("file") ?? `${root}/demo/showcase.json`);
const workspace = resolve(option("workspace") ?? root);
if (!["check", "import", "export"].includes(command)) {
  console.log("用法：pnpm demo:import | pnpm demo:export --space=ID --out=新文件.json\nnode scripts/demo-pack.mjs check|import --file=包.json [--workspace=隔离工作目录]\n导出只包含资料、讲解版本和路线，不包含追问、作答与复习记录。需要 Node 24。");
  process.exit(command ? 1 : 0);
}

try {
  if (command === "check") {
    const pack = validate(JSON.parse(readFileSync(packFile, "utf8")));
    console.log(`校验通过：${pack.name}，${pack.sources.length} 份资料，${pack.lessons.length} 个版本`);
  } else if (command === "import") {
    // 全量校验在开库之前完成，非法包不会创建数据库。
    const pack = validate(JSON.parse(readFileSync(packFile, "utf8")));
    const hash = createHash("sha256").update(JSON.stringify(pack)).digest("hex");
    process.chdir(workspace);
    const existed = existsSync("data/gewu.db");
    const db = getDb();
    const hasReceipts = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='demo_imports'").get();
    const findPrevious = () => db.prepare("SELECT s.id,r.hash FROM demo_imports r JOIN spaces s ON s.id=r.space_id WHERE r.package_id=?").get(pack.id);
    const previous = hasReceipts ? findPrevious() : null;
    if (previous) {
      if (previous.hash !== hash) throw new Error("同标识演示包内容已变化，请使用新的包 id；不会覆盖现有空间");
      console.log(`已导入，跳过：空间 #${previous.id}。若已手动删除部分内容，请删除整个演示空间后重导。`);
    } else {
      if (existed) {
        mkdirSync("data/backups", { recursive: true });
        const target = resolve(`data/backups/before-demo-${Date.now()}.db`);
        await backup(db, target);
        console.log(`写入前备份：${target}`);
      }
      db.exec("BEGIN IMMEDIATE");
      try {
        db.exec("CREATE TABLE IF NOT EXISTS demo_imports(package_id TEXT PRIMARY KEY, hash TEXT NOT NULL, space_id INTEGER NOT NULL)");
        if (findPrevious()) throw new Error("其他进程已导入，请重新执行查看状态");
        const space = Number(db.prepare("INSERT INTO spaces(name,note,roadmap,roadmap_at) VALUES(?,?,?,datetime('now','localtime'))").run(
          `演示 · ${pack.name}`, `预置案例；${pack.provenance}`, JSON.stringify({ stages: pack.roadmap })
        ).lastInsertRowid);
        const sourceIds = new Map(), docIds = new Map();
        for (const s of pack.sources) {
          const id = Number(db.prepare("INSERT INTO sources(title,kind,status,md_content,chars,concepts,space_id) VALUES(?,'md','ready',?,?,?,?)").run(s.title, s.markdown, s.markdown.length, JSON.stringify(s.concepts), space).lastInsertRowid);
          sourceIds.set(s.key, id);
        }
        for (const l of pack.lessons) {
          const refs = l.sources.map(k => sourceIds.get(k));
          const context = l.sources.length ? { text: l.sources.map(k => pack.sources.find(s => s.key === k).markdown).join("\n\n"), sources: l.sources.map(k => ({ id: sourceIds.get(k), title: pack.sources.find(s => s.key === k).title, revision: 1 })) } : null;
          const id = Number(db.prepare("INSERT INTO docs(parent_id,title,doc,instruction,space_id,origin_concept,source_ids,source_context) VALUES(?,?,?,?,?,?,?,?)").run(l.parent ? docIds.get(l.parent) : null, l.doc.title, JSON.stringify(l.doc), l.instruction, space, l.concept, JSON.stringify(refs), context ? JSON.stringify(context) : null).lastInsertRowid);
          docIds.set(l.key, id);
        }
        db.prepare("INSERT OR REPLACE INTO demo_imports(package_id,hash,space_id) VALUES(?,?,?)").run(pack.id, hash, space);
        db.exec("COMMIT");
        console.log(`导入完成：空间 #${space}，${pack.sources.length} 份资料、${pack.lessons.length} 个版本。刷新页面并切换到「演示 · ${pack.name}」。`);
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    }
    db.close();
  } else {
    const spaceId = Number(option("space")), output = option("out");
    if (!Number.isSafeInteger(spaceId) || spaceId <= 0 || !output) throw new Error("导出必须提供 --space=ID --out=新文件.json");
    process.chdir(workspace);
    if (!existsSync("data/gewu.db")) throw new Error("数据库不存在");
    const db = getDb();
    db.exec("BEGIN");
    try {
      const space = db.prepare("SELECT * FROM spaces WHERE id=?").get(spaceId);
      if (!space) throw new Error("空间不存在");
      const sources = db.prepare("SELECT * FROM sources WHERE space_id=? ORDER BY id").all(spaceId);
      if (sources.some(s => s.status !== "ready")) throw new Error("空间含未解析完成或失败的资料，请先处理");
      const docs = db.prepare("SELECT * FROM docs WHERE space_id=? ORDER BY id").all(spaceId);
      const pack = validate({ format: 1, id: option("id") ?? `export-${spaceId}`, name: space.name.replace(/^演示 · /, "").slice(0,40), provenance: "从指定空间导出；发布前需人工检查资料与讲解内容", sources: sources.map(s => ({ key: `s${s.id}`, title: s.title, markdown: s.md_content, concepts: s.concepts ? JSON.parse(s.concepts) : [] })), lessons: docs.map(d => ({ key: `d${d.id}`, parent: d.parent_id === null ? null : `d${d.parent_id}`, instruction: d.instruction, concept: d.origin_concept ?? d.title, sources: JSON.parse(d.source_ids).map(id => `s${id}`), doc: JSON.parse(d.doc) })), roadmap: space.roadmap ? JSON.parse(space.roadmap).stages : [] });
      writeFileSync(resolve(output), `${JSON.stringify(pack, null, 2)}\n`, { flag: "wx" });
      db.exec("COMMIT");
      console.log(`已导出：${resolve(output)}。请检查内容后再对外分发；不含个人学习记录。`);
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    db.close();
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
