/**
 * attempts 表访问：练习判定记录的写入与统计聚合。
 * 统计口径：每次"检查/判定"记一条（含重做），正确率按次计算。
 */
import { getDb } from "./index";

export type AttemptType = "quiz" | "fillBlank" | "match" | "sort";

export const ATTEMPT_TYPES: readonly AttemptType[] = ["quiz", "fillBlank", "match", "sort"];

export function insertAttempt(docId: number, blockType: AttemptType, correct: boolean): void {
  getDb()
    .prepare("INSERT INTO attempts (doc_id, block_type, correct) VALUES (?, ?, ?)")
    .run(docId, blockType, correct ? 1 : 0);
}

/** 单概念的练习统计（补练模式的输入） */
export function getDocAttemptStats(docId: number): {
  overall: { total: number; correct: number };
  byType: { blockType: AttemptType; total: number; correct: number }[];
} {
  const db = getDb();
  const overall = db
    .prepare("SELECT COUNT(*) AS total, COALESCE(SUM(correct), 0) AS correct FROM attempts WHERE doc_id = ?")
    .get(docId) as { total: number; correct: number };
  const byType = (
    db
      .prepare(
        "SELECT block_type, COUNT(*) AS total, SUM(correct) AS correct FROM attempts WHERE doc_id = ? GROUP BY block_type ORDER BY total DESC"
      )
      .all(docId) as unknown as { block_type: AttemptType; total: number; correct: number }[]
  ).map((r) => ({ blockType: r.block_type, total: r.total, correct: r.correct }));
  return { overall, byType };
}

export interface DailyPoint {
  day: string; // YYYY-MM-DD（本地时区）
  total: number;
  correct: number;
}

export interface TypeStat {
  blockType: AttemptType;
  total: number;
  correct: number;
}

export interface ConceptStat {
  docId: number;
  title: string;
  total: number;
  correct: number;
  lastDay: string;
}

export interface StatsPayload {
  docCount: number;
  attemptCount: number;
  /** 无练习记录时为 null（前端显示空态） */
  correctRate: number | null;
  /** 连续学习天数：从今天（或昨天）向前数有记录的连续天 */
  streak: number;
  /** 近 14 天日序列（含无记录的空日，升序） */
  daily: DailyPoint[];
  byType: TypeStat[];
  /** 有练习记录的概念，按练习量降序 */
  concepts: ConceptStat[];
}

function localDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function shiftDay(day: string, offsetDays: number): string {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + offsetDays);
  return localDay(d);
}

/** 全局或空间内统计：spaceId 提供时所有口径只算该空间的讲解与练习 */
export function getStats(spaceId?: number): StatsPayload {
  const db = getDb();
  const inSpace = spaceId !== undefined;
  const docInSpace = "doc_id IN (SELECT id FROM docs WHERE space_id = ?)";
  const spaceParams = inSpace ? [spaceId as number] : [];

  const docCount = Number(
    (
      db
        .prepare(
          inSpace ? "SELECT COUNT(*) AS n FROM docs WHERE space_id = ?" : "SELECT COUNT(*) AS n FROM docs"
        )
        .get(...spaceParams) as { n: number }
    ).n
  );
  const overall = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(correct), 0) AS c FROM attempts ${inSpace ? `WHERE ${docInSpace}` : ""}`
    )
    .get(...spaceParams) as { n: number; c: number };
  const correctRate =
    overall.n > 0 ? Math.round((overall.c / overall.n) * 1000) / 10 : null;

  // 近 14 天日序列：DB 只取有记录的日，空日在 JS 补齐
  const dailyRows = db
    .prepare(
      `SELECT date(created_at) AS day, COUNT(*) AS total, SUM(correct) AS correct FROM attempts WHERE created_at >= date('now','localtime','-13 days') ${
        inSpace ? `AND ${docInSpace}` : ""
      } GROUP BY day`
    )
    .all(...spaceParams) as unknown as { day: string; total: number; correct: number }[];
  const dailyMap = new Map(dailyRows.map((r) => [r.day, r]));
  const daily: DailyPoint[] = [];
  for (let i = 13; i >= 0; i--) {
    const day = shiftDay(localDay(new Date()), -i);
    const row = dailyMap.get(day);
    daily.push({ day, total: row?.total ?? 0, correct: row?.correct ?? 0 });
  }

  const typeRows = db
    .prepare(
      `SELECT block_type, COUNT(*) AS total, SUM(correct) AS correct FROM attempts ${
        inSpace ? `WHERE ${docInSpace}` : ""
      } GROUP BY block_type`
    )
    .all(...spaceParams) as unknown as { block_type: AttemptType; total: number; correct: number }[];
  const byType: TypeStat[] = ATTEMPT_TYPES.map((blockType) => {
    const row = typeRows.find((r) => r.block_type === blockType);
    return { blockType, total: row?.total ?? 0, correct: row?.correct ?? 0 };
  }).filter((t) => t.total > 0);

  const conceptRows = db
    .prepare(
      `SELECT a.doc_id AS docId, d.title AS title, COUNT(*) AS total,
              SUM(a.correct) AS correct, MAX(date(a.created_at)) AS lastDay
       FROM attempts a JOIN docs d ON d.id = a.doc_id ${inSpace ? "AND d.space_id = ?" : ""}
       GROUP BY a.doc_id ORDER BY total DESC LIMIT 50`
    )
    .all(...spaceParams) as unknown as ConceptStat[];
  const concepts = conceptRows.map((r) => ({
    ...r,
    total: Number(r.total),
    correct: Number(r.correct),
  }));

  // 连续学习天数：锚点是今天或昨天（今天还没练不打断连续）
  const dayRows = db
    .prepare(
      `SELECT DISTINCT date(created_at) AS day FROM attempts ${
        inSpace ? `WHERE ${docInSpace}` : ""
      } ORDER BY day DESC`
    )
    .all(...spaceParams) as unknown as { day: string }[];
  const days = dayRows.map((r) => r.day);
  const today = localDay(new Date());
  let streak = 0;
  if (days.length > 0) {
    let expected = days[0] === today ? today : shiftDay(today, -1);
    for (const day of days) {
      if (day === expected) {
        streak++;
        expected = shiftDay(expected, -1);
      } else if (day !== today) {
        break;
      }
    }
  }

  return {
    docCount,
    attemptCount: overall.n,
    correctRate,
    streak,
    daily,
    byType,
    concepts,
  };
}
