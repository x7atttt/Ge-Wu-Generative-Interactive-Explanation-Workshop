/**
 * spaces 表访问：「空间」= 复习战役容器（资料 + 概念地图 + 讲解 + 练习统计的归属）。
 * 概念地图是核心聚合：各资料提炼的概念 × 讲解/练习状态，弱项阈值与统计面板一致（<60% 且样本 ≥3）。
 */
import { getDb } from "./index";
import { listSources } from "./sources";
import { listDocsBySpace } from "./docs";

export interface SpaceRow {
  id: number;
  name: string;
  note: string;
  examDate: string | null;
  createdAt: string;
}

interface RawSpace {
  id: number;
  name: string;
  note: string;
  exam_date: string | null;
  created_at: string;
}

export function getSpace(id: number): SpaceRow | null {
  const row = getDb()
    .prepare("SELECT id, name, note, exam_date, created_at FROM spaces WHERE id = ?")
    .get(id) as unknown as RawSpace | undefined;
  return row ? { ...row, examDate: row.exam_date, createdAt: row.created_at } : null;
}

export function listSpaces(): SpaceRow[] {
  const rows = getDb()
    .prepare("SELECT id, name, note, exam_date, created_at FROM spaces ORDER BY id DESC")
    .all() as unknown as RawSpace[];
  return rows.map((row) => ({ ...row, examDate: row.exam_date, createdAt: row.created_at }));
}

export function createSpace(input: { name: string; note?: string; examDate?: string | null }): number {
  const result = getDb()
    .prepare("INSERT INTO spaces (name, note, exam_date) VALUES (?, ?, ?)")
    .run(input.name.slice(0, 60), (input.note ?? "").slice(0, 200), input.examDate ?? null);
  return Number(result.lastInsertRowid);
}

export function updateSpace(
  id: number,
  input: { name?: string; note?: string; examDate?: string | null }
): void {
  const current = getSpace(id);
  if (!current) return;
  getDb()
    .prepare("UPDATE spaces SET name = ?, note = ?, exam_date = ? WHERE id = ?")
    .run(
      (input.name ?? current.name).slice(0, 60),
      (input.note ?? current.note).slice(0, 200),
      input.examDate !== undefined ? input.examDate : current.examDate,
      id
    );
}

/** 删除空间：资料与讲解移回未分组（不级联删除学习资产），再删空间本身 */
export function deleteSpace(id: number): void {
  const db = getDb();
  db.prepare("UPDATE sources SET space_id = NULL WHERE space_id = ?").run(id);
  db.prepare("UPDATE docs SET space_id = NULL WHERE space_id = ?").run(id);
  db.prepare("DELETE FROM spaces WHERE id = ?").run(id);
}

export type ConceptStatus = "new" | "explained" | "practiced" | "weak";

export interface ConceptState {
  /** 概念名（跨资料同名合并） */
  text: string;
  /** 提炼自哪些资料（点击生成时默认附加） */
  sourceIds: number[];
  /** 该概念名下已生成的讲解（含 refine 子版本） */
  docIds: number[];
  status: ConceptStatus;
  practice: { total: number; correct: number };
}

export interface SpaceMap {
  space: SpaceRow;
  concepts: ConceptState[];
  summary: { sources: number; explained: number; weak: number };
}

const WEAK_RATE = 0.6;
const WEAK_MIN_ATTEMPTS = 3;

/** 概念地图：资料提炼概念 × 讲解/练习状态（与统计面板弱项阈值一致） */
export function getSpaceMap(spaceId: number): SpaceMap | null {
  const space = getSpace(spaceId);
  if (!space) return null;

  // 概念聚合：同空间就绪资料的提炼缓存，同名概念合并来源
  const byText = new Map<string, Set<number>>();
  for (const source of listSources(200, spaceId)) {
    if (source.status !== "ready") continue;
    for (const concept of source.concepts) {
      const key = concept.trim();
      if (!key) continue;
      const ids = byText.get(key) ?? new Set<number>();
      ids.add(source.id);
      byText.set(key, ids);
    }
  }

  // 讲解对齐：空间内带出身概念的讲解（refine 子版本继承出身，同名并列）
  const docIdsByText = new Map<string, number[]>();
  for (const doc of listDocsBySpace(spaceId)) {
    if (!doc.originConcept) continue;
    const key = doc.originConcept.trim();
    const ids = docIdsByText.get(key) ?? [];
    ids.push(doc.id);
    docIdsByText.set(key, ids);
  }

  // 练习聚合：所有对齐讲解的判定合并到概念
  const allDocIds = [...docIdsByText.values()].flat();
  const practiceByDoc = new Map<number, { total: number; correct: number }>();
  if (allDocIds.length > 0) {
    const placeholders = allDocIds.map(() => "?").join(",");
    const rows = getDb()
      .prepare(`SELECT doc_id, COUNT(*) AS total, SUM(correct) AS correct FROM attempts WHERE doc_id IN (${placeholders}) GROUP BY doc_id`)
      .all(...allDocIds) as unknown as { doc_id: number; total: number; correct: number }[];
    for (const row of rows) practiceByDoc.set(row.doc_id, { total: row.total, correct: row.correct });
  }

  const concepts: ConceptState[] = [];
  for (const [text, sourceIds] of byText) {
    const docIds = docIdsByText.get(text) ?? [];
    const practice = docIds.reduce(
      (acc, id) => {
        const p = practiceByDoc.get(id);
        return p ? { total: acc.total + p.total, correct: acc.correct + p.correct } : acc;
      },
      { total: 0, correct: 0 }
    );
    let status: ConceptStatus = "new";
    if (docIds.length > 0) {
      status = "explained";
      if (practice.total > 0) {
        const rate = practice.correct / practice.total;
        status = practice.total >= WEAK_MIN_ATTEMPTS && rate < WEAK_RATE ? "weak" : "practiced";
      }
    }
    concepts.push({
      text,
      sourceIds: [...sourceIds],
      docIds,
      status,
      practice,
    });
  }
  // 未学在前、薄弱优先，其后按已练/已讲，最后按资料顺序（Map 保持插入序）
  const order: Record<ConceptStatus, number> = { weak: 0, new: 1, practiced: 2, explained: 3 };
  concepts.sort((a, b) => order[a.status] - order[b.status] || b.practice.total - a.practice.total);

  const sourceCount = listSources(200, spaceId).filter((s) => s.status === "ready").length;
  return {
    space,
    concepts,
    summary: {
      sources: sourceCount,
      explained: concepts.filter((c) => c.docIds.length > 0).length,
      weak: concepts.filter((c) => c.status === "weak").length,
    },
  };
}
