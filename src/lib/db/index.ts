/**
 * SQLite 连接（Node 24 内置 node:sqlite，零第三方依赖）。
 * 单文件 data/gewu.db，首次访问自动建库建表；globalThis 单例防 dev 热重载重复开库。
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

type DbGlobal = typeof globalThis & { __gewuDb?: DatabaseSync };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER REFERENCES docs(id),
  title TEXT NOT NULL,
  doc TEXT NOT NULL,
  instruction TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS asks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id INTEGER NOT NULL REFERENCES docs(id),
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_asks_doc ON asks(doc_id);
CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id INTEGER NOT NULL REFERENCES docs(id),
  block_type TEXT NOT NULL CHECK(block_type IN ('quiz','fillBlank','match','sort')),
  correct INTEGER NOT NULL CHECK(correct IN (0,1)),
  -- 学习统计按"天"聚合，用本地时间写日界（库内其余表沿用 UTC，仅此表面向按日分组）
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_attempts_doc ON attempts(doc_id);
CREATE INDEX IF NOT EXISTS idx_attempts_time ON attempts(created_at);
`;

export function getDb(): DatabaseSync {
  const g = globalThis as DbGlobal;
  if (g.__gewuDb) return g.__gewuDb;

  const dir = path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, "gewu.db"));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  // 老库迁移：补 instruction 列（已存在则忽略，幂等）
  try {
    db.exec("ALTER TABLE docs ADD COLUMN instruction TEXT");
  } catch {
    // duplicate column: 列已存在
  }
  g.__gewuDb = db;
  return db;
}
