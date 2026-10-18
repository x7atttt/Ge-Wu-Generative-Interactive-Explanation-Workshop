import { randomUUID } from "node:crypto";
import { getDb } from "./index";
import { hydrateStudyCard, sampleExamCards, scheduleAndLogReview, type ReviewCard } from "./cards";
import type { ReviewGrade } from "@/lib/fsrs";

export type ExamGrade = ReviewGrade | "skipped";
export interface ExamSession {
  id: string;
  spaceId: number;
  cards: ReviewCard[];
  answers: Record<number, ExamGrade>;
  createdAt: string;
  completedAt: string | null;
}

export class ExamError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export function getExam(id: string): ExamSession | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM exam_sessions WHERE id = ?").get(id) as
    { id: string; space_id: number; cards: string; created_at: string; completed_at: string | null } | undefined;
  if (!row) return null;
  const answers = db.prepare("SELECT card_id, grade FROM exam_answers WHERE session_id = ?").all(id) as
    { card_id: number; grade: ExamGrade }[];
  const cards: ReviewCard[] = JSON.parse(row.cards);
  return { id: row.id, spaceId: row.space_id, cards: row.completed_at ? cards : cards.map(hydrateStudyCard),
    answers: Object.fromEntries(answers.map((a) => [a.card_id, a.grade])),
    createdAt: row.created_at, completedAt: row.completed_at };
}

export function listExams(spaceId: number): ExamSession[] {
  const rows = getDb().prepare("SELECT id FROM exam_sessions WHERE space_id = ? ORDER BY rowid DESC LIMIT 20").all(spaceId) as { id: string }[];
  return rows.map((row) => getExam(row.id)!);
}

export function startExam(spaceId: number): ExamSession {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const active = db.prepare("SELECT id FROM exam_sessions WHERE space_id = ? AND completed_at IS NULL LIMIT 1").get(spaceId) as { id: string } | undefined;
    if (active) {
      const session = getExam(active.id)!;
      db.exec("COMMIT");
      return session;
    }
    const cards = sampleExamCards(spaceId, 20);
    if (cards.length === 0) throw new ExamError("这个空间还没有卡片，请先添加复习卡", 400);
    const id = randomUUID();
    db.prepare("INSERT INTO exam_sessions (id, space_id, cards) VALUES (?, ?, ?)").run(id, spaceId, JSON.stringify(cards));
    const session = getExam(id)!;
    db.exec("COMMIT");
    return session;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function answerExam(id: string, cardId: number, grade: ExamGrade): ExamSession {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const session = getExam(id);
    if (!session) throw new ExamError("自测记录不存在", 404);
    const previous = session.answers[cardId];
    if (previous !== undefined) {
      if (previous !== grade) throw new ExamError("这道题已经评分，请刷新进度", 409);
      db.exec("COMMIT");
      return session;
    }
    const next = session.cards.find((c) => session.answers[c.id] === undefined);
    if (!next || next.id !== cardId) throw new ExamError("请按当前题序作答", 409);
    const exists = db.prepare("SELECT id FROM cards WHERE id = ? AND space_id = ?").get(cardId, session.spaceId);
    if (grade === "skipped") {
      if (exists && !next.issue) throw new ExamError("仍存在且题面完整的卡片不能跳过评分", 409);
    } else {
      if (next.issue) throw new ExamError("题面不完整，请跳过此题；不会影响记忆排期", 422);
      if (!exists) throw new ExamError("卡片已被删除，可跳过此题；历史题面仍保留", 410);
      scheduleAndLogReview(cardId, grade);
    }
    db.prepare("INSERT INTO exam_answers (session_id, card_id, grade) VALUES (?, ?, ?)").run(id, cardId, grade);
    if (Object.keys(session.answers).length + 1 === session.cards.length) {
      db.prepare("UPDATE exam_sessions SET completed_at = datetime('now','localtime') WHERE id = ?").run(id);
    }
    const result = getExam(id)!;
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
