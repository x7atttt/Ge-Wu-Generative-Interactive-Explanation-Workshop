/** cards 表访问：FSRS 复习卡的提取（讲解 quiz/填空机械转换）与调度写入 */
import { getDb } from "./index";
import { getDoc } from "./docs";
import { localDay, schedule, type ReviewGrade } from "@/lib/fsrs";

export interface ReviewCard {
  id: number;
  docId: number;
  originConcept: string | null;
  front: string;
  back: string;
  /** FSRS 记忆状态（0 = 未初始化新卡） */
  difficulty: number;
  stability: number;
  lastReview: string | null;
  /** 本次排期间隔（天）；repetitions 仅作轮次展示 */
  intervalDays: number;
  repetitions: number;
  due: string;
}

interface RawCard {
  id: number;
  doc_id: number;
  origin_concept: string | null;
  front: string;
  back: string;
  difficulty: number;
  stability: number;
  last_review: string | null;
  interval_days: number;
  repetitions: number;
  due: string;
}

const SELECT_CARD =
  "SELECT id, doc_id, origin_concept, front, back, difficulty, stability, last_review, interval_days, repetitions, due FROM cards";

function toCard(raw: RawCard): ReviewCard {
  return {
    id: raw.id,
    docId: raw.doc_id,
    originConcept: raw.origin_concept,
    front: raw.front,
    back: raw.back,
    difficulty: raw.difficulty,
    stability: raw.stability,
    lastReview: raw.last_review,
    intervalDays: raw.interval_days,
    repetitions: raw.repetitions,
    due: raw.due,
  };
}

/** 从讲解的 quiz/fillBlank 块机械提取卡片（零 LLM，内容已被练习验证）；同 doc 重复提取按 front 去重 */
export function createCardsFromDoc(docId: number): { added: number; skipped: number } {
  const row = getDoc(docId);
  if (!row) return { added: 0, skipped: 0 };

  const existing = new Set(
    (
      getDb()
        .prepare("SELECT front FROM cards WHERE doc_id = ?")
        .all(docId) as unknown as { front: string }[]
    ).map((r) => r.front)
  );

  const inserts: { front: string; back: string }[] = [];
  for (const block of row.doc.blocks) {
    if (block.type === "quiz") {
      const answer = block.options[block.answer] ?? "";
      inserts.push({
        front: block.question,
        back: `答案：${answer}${block.explanation ? `\n解析：${block.explanation}` : ""}`,
      });
    } else if (block.type === "fillBlank") {
      const back = block.blanks
        .map((b, i) => `空${i + 1}：${b.options[b.answer] ?? ""}${b.explanation ? ` —— ${b.explanation}` : ""}`)
        .join("\n");
      inserts.push({
        front: `${block.prompt ? `${block.prompt}\n` : ""}${block.text}`,
        back,
      });
    }
  }

  let added = 0;
  let skipped = 0;
  const db = getDb();
  const stmt = db.prepare(
    "INSERT INTO cards (space_id, doc_id, origin_concept, front, back, due) VALUES (?, ?, ?, ?, ?, ?)"
  );
  for (const card of inserts) {
    if (existing.has(card.front) || inserts.filter((c) => c.front === card.front).length > 1) {
      skipped++;
      continue;
    }
    // 新卡立即进入今日队列（repetitions=0，due=今天）
    stmt.run(row.spaceId, docId, row.originConcept, card.front, card.back, localDay());
    added++;
  }
  return { added, skipped };
}

/** 到期队列（due <= today），按到期先后 */
export function listDueCards(spaceId: number, limit = 50): ReviewCard[] {
  const rows = getDb()
    .prepare(`${SELECT_CARD} WHERE space_id = ? AND due <= ? ORDER BY due ASC, id ASC LIMIT ?`)
    .all(spaceId, localDay(), limit) as unknown as RawCard[];
  return rows.map(toCard);
}

/** 综合测验卷：空间全部卡（不看 due）随机抽样——模拟考检验整体记忆，count 是上限 */
export function sampleExamCards(spaceId: number, count: number): ReviewCard[] {
  const rows = getDb()
    .prepare(`${SELECT_CARD} WHERE space_id = ? ORDER BY RANDOM() LIMIT ?`)
    .all(spaceId, count) as unknown as RawCard[];
  return rows.map(toCard);
}

/** 空间全部卡（管理面板用，含未到期与手写卡），按概念聚拢、到期优先 */
export function listAllCards(spaceId: number): ReviewCard[] {
  const rows = getDb()
    .prepare(
      `${SELECT_CARD} WHERE space_id = ? ORDER BY COALESCE(origin_concept, '~~~') ASC, due ASC, id ASC`
    )
    .all(spaceId) as unknown as RawCard[];
  return rows.map(toCard);
}

/** 手写卡：不属于任何讲解（doc_id NULL），新卡与提取卡同调度初值（due=今日） */
export function createManualCard(input: {
  spaceId: number;
  front: string;
  back: string;
  concept?: string | null;
}): ReviewCard {
  const db = getDb();
  const result = db
    .prepare(
      "INSERT INTO cards (space_id, doc_id, origin_concept, front, back, due) VALUES (?, NULL, ?, ?, ?, ?)"
    )
    .run(input.spaceId, input.concept?.trim() || null, input.front, input.back, localDay());
  const raw = db
    .prepare(`${SELECT_CARD} WHERE id = ?`)
    .get(Number(result.lastInsertRowid)) as unknown as RawCard;
  return toCard(raw);
}

/** 批量手写卡：行式导入（每行 题面|答案|概念可选），逐张走手写卡口径；返回成功张数 */
export function createManualCards(
  spaceId: number,
  items: { front: string; back: string; concept?: string | null }[]
): number {
  const db = getDb();
  const stmt = db.prepare(
    "INSERT INTO cards (space_id, doc_id, origin_concept, front, back, due) VALUES (?, NULL, ?, ?, ?, ?)"
  );
  let added = 0;
  for (const item of items) {
    stmt.run(spaceId, item.concept?.trim() || null, item.front, item.back, localDay());
    added++;
  }
  return added;
}

/** 单张编辑：题面/答案/概念归属（不传的字段不动） */
export function updateCard(
  id: number,
  input: { front?: string; back?: string; concept?: string | null }
): ReviewCard | null {
  const db = getDb();
  const raw = db.prepare(`${SELECT_CARD} WHERE id = ?`).get(id) as unknown as RawCard | undefined;
  if (!raw) return null;
  db.prepare("UPDATE cards SET front = ?, back = ?, origin_concept = ? WHERE id = ?").run(
    input.front ?? raw.front,
    input.back ?? raw.back,
    input.concept !== undefined ? input.concept?.trim() || null : raw.origin_concept,
    id
  );
  return toCard(db.prepare(`${SELECT_CARD} WHERE id = ?`).get(id) as unknown as RawCard);
}

export function deleteCard(id: number): boolean {
  return getDb().prepare("DELETE FROM cards WHERE id = ?").run(id).changes > 0;
}

/** 空间的复习卡概况（地图头部/复习入口展示） */
export function cardCounts(spaceId: number): { total: number; due: number } {
  const db = getDb();
  const total = Number(
    (db.prepare("SELECT COUNT(*) AS n FROM cards WHERE space_id = ?").get(spaceId) as { n: number }).n
  );
  const due = Number(
    (
      db
        .prepare("SELECT COUNT(*) AS n FROM cards WHERE space_id = ? AND due <= ?")
        .get(spaceId, localDay()) as { n: number }
    ).n
  );
  return { total, due };
}

/** 评分调度：应用 FSRS 推演记忆状态并写回；again 当日重见（due=今日） */
export function reviewCard(id: number, grade: ReviewGrade): ReviewCard | null {
  const db = getDb();
  const raw = db.prepare(`${SELECT_CARD} WHERE id = ?`).get(id) as unknown as RawCard | undefined;
  if (!raw) return null;
  const next = schedule(
    { difficulty: raw.difficulty, stability: raw.stability, lastReview: raw.last_review },
    grade
  );
  db.prepare(
    "UPDATE cards SET difficulty = ?, stability = ?, last_review = ?, interval_days = ?, repetitions = repetitions + 1, due = ? WHERE id = ?"
  ).run(next.difficulty, next.stability, next.lastReview, next.intervalDays, next.due, id);
  return {
    ...toCard(raw),
    difficulty: next.difficulty,
    stability: next.stability,
    lastReview: next.lastReview,
    intervalDays: next.intervalDays,
    repetitions: raw.repetitions + 1,
    due: next.due,
  };
}

export function clearSpaceCards(spaceId: number): void {
  getDb().prepare("DELETE FROM cards WHERE space_id = ?").run(spaceId);
}
