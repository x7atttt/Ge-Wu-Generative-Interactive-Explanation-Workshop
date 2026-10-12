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
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  -- kind: txt | md | pdf | docx | doc（pdf/word 经 MinerU 解析，txt/md 直读）
  kind TEXT NOT NULL,
  -- status: parsing（MinerU 解析中）| ready | error
  status TEXT NOT NULL CHECK(status IN ('parsing','ready','error')),
  md_content TEXT NOT NULL DEFAULT '',
  chars INTEGER NOT NULL DEFAULT 0,
  -- 概念提炼结果缓存（JSON 字符串数组，一键提炼按钮写入）
  concepts TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  -- 解析进度展示（如 "3/12 页"，来自 MinerU extract_progress，仅 parsing 期间有意义）
  progress TEXT NOT NULL DEFAULT '',
  -- MinerU 批量任务追踪：batch 内按 file_name 对回结果
  batch_id TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_sources_batch ON sources(batch_id);
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
  // 老库迁移：sources 补 progress 列（迭代 15 前建的表）
  try {
    db.exec("ALTER TABLE sources ADD COLUMN progress TEXT NOT NULL DEFAULT ''");
  } catch {
    // duplicate column: 列已存在
  }
  g.__gewuDb = db;
  return db;
}
