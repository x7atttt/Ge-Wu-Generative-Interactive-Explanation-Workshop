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
CREATE TABLE IF NOT EXISTS spaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  -- 空间说明（如"期末·操作系统 考纲+课件+真题"）
  note TEXT NOT NULL DEFAULT '',
  -- 考试/截止日期（YYYY-MM-DD，倒计时用；迭代 17 复习计划的锚点）
  exam_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id INTEGER REFERENCES spaces(id),
  doc_id INTEGER REFERENCES docs(id),
  origin_concept TEXT,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  -- FSRS-6 记忆状态（算法见 lib/fsrs.ts），due/last_review 为本地日期 YYYY-MM-DD；
  -- 0 值 difficulty/stability 表示未初始化（新卡，首评走 init 路径）
  difficulty REAL NOT NULL DEFAULT 0,
  stability REAL NOT NULL DEFAULT 0,
  last_review TEXT,
  -- ease 为 SM-2 时代遗留（迁移来源，已冻结不再写入）；repetitions 仅作轮次展示
  ease REAL NOT NULL DEFAULT 2.5,
  interval_days REAL NOT NULL DEFAULT 0,
  repetitions INTEGER NOT NULL DEFAULT 0,
  due TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_cards_space_due ON cards(space_id, due);
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
  // 老库迁移：空间归属与讲解出身（迭代 16 前建的表；在线实例另用一次性脚本补列）
  try {
    db.exec("ALTER TABLE sources ADD COLUMN space_id INTEGER REFERENCES spaces(id)");
  } catch {
    // duplicate column: 列已存在
  }
  for (const col of [
    "ALTER TABLE docs ADD COLUMN space_id INTEGER REFERENCES spaces(id)",
    "ALTER TABLE docs ADD COLUMN origin_concept TEXT",
    "ALTER TABLE docs ADD COLUMN source_ids TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE cards ADD COLUMN difficulty REAL NOT NULL DEFAULT 0",
    "ALTER TABLE cards ADD COLUMN stability REAL NOT NULL DEFAULT 0",
    "ALTER TABLE cards ADD COLUMN last_review TEXT",
  ]) {
    try {
      db.exec(col);
    } catch {
      // duplicate column: 列已存在
    }
  }
  // SM-2 → FSRS 状态迁移（幂等：stability>0 的行不再改；due 不动保证今日队列不跳变）
  //   S ≈ 当前 SM-2 间隔（≥0.5 天），D 由 ease 线性映射（2.5→5 中性，1.3→10 最难），
  //   last_review ≈ due − interval_days（SM-2 未存上次复习日，按排期间隔倒推）
  const legacy = db
    .prepare(
      "SELECT id, ease, interval_days, due FROM cards WHERE repetitions > 0 AND stability = 0"
    )
    .all() as unknown as { id: number; ease: number; interval_days: number; due: string }[];
  if (legacy.length > 0) {
    const update = db.prepare(
      "UPDATE cards SET difficulty = ?, stability = ?, last_review = ? WHERE id = ?"
    );
    for (const row of legacy) {
      const stability = Math.max(row.interval_days, 0.5);
      const difficulty = Math.min(10, Math.max(1, 5 + (2.5 - row.ease) * (25 / 6)));
      // addDays 不接受负数，倒推用时间戳直算
      const dueDate = new Date(`${row.due}T00:00:00`);
      dueDate.setDate(dueDate.getDate() - Math.round(row.interval_days));
      const lastReview = `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, "0")}-${String(dueDate.getDate()).padStart(2, "0")}`;
      update.run(difficulty, stability, lastReview, row.id);
    }
  }
  g.__gewuDb = db;
  return db;
}
