/**
 * spaces 表访问：「空间」= 复习战役容器（资料 + 概念地图 + 讲解 + 练习统计的归属）。
 * 概念地图是核心聚合：各资料提炼的概念 × 讲解/练习状态，弱项阈值与统计面板一致（<60% 且样本 ≥3）。
 */
import { getDb } from "./index";
import { listSources } from "./sources";
import { listDocsBySpace } from "./docs";
import { cardCounts } from "./cards";

/** 学习路线的一个站点（LLM 生成快照，概念名与地图白名单对齐） */
export interface RoadmapStage {
  title: string;
  goal: string;
  concepts: string[];
}

export interface SpaceRow {
  id: number;
  name: string;
  note: string;
  examDate: string | null;
  roadmap: RoadmapStage[] | null;
  roadmapAt: string | null;
  createdAt: string;
  /** 面板/枢纽用计数（聚合子查询带出） */
  sourceCount: number;
  docCount: number;
}

interface RawSpace {
  id: number;
  name: string;
  note: string;
  exam_date: string | null;
  roadmap: string;
  roadmap_at: string | null;
  created_at: string;
  source_count: number;
  doc_count: number;
}

/** 容错解析路线快照（坏 JSON / 空站列表按无路线处理） */
function parseRoadmap(raw: string): RoadmapStage[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { stages?: RoadmapStage[] };
    return Array.isArray(parsed.stages) && parsed.stages.length > 0 ? parsed.stages : null;
  } catch {
    return null;
  }
}

function toSpace(raw: RawSpace): SpaceRow {
  return {
    id: raw.id,
    name: raw.name,
    note: raw.note,
    examDate: raw.exam_date,
    roadmap: parseRoadmap(raw.roadmap),
    roadmapAt: raw.roadmap_at,
    createdAt: raw.created_at,
    sourceCount: Number(raw.source_count),
    docCount: Number(raw.doc_count),
  };
}

const SELECT_SPACE =
  "SELECT id, name, note, exam_date, roadmap, roadmap_at, created_at, " +
  "(SELECT COUNT(*) FROM sources WHERE space_id = spaces.id) AS source_count, " +
  "(SELECT COUNT(*) FROM docs WHERE space_id = spaces.id) AS doc_count " +
  "FROM spaces";

export function getSpace(id: number): SpaceRow | null {
  const row = getDb()
    .prepare(`${SELECT_SPACE} WHERE id = ?`)
    .get(id) as unknown as RawSpace | undefined;
  return row ? toSpace(row) : null;
}

export function listSpaces(): SpaceRow[] {
  const rows = getDb()
    .prepare(`${SELECT_SPACE} ORDER BY id DESC`)
    .all() as unknown as RawSpace[];
  return rows.map(toSpace);
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

/** 写入/覆盖学习路线快照（生成时间取本地时间） */
export function setRoadmap(id: number, stages: RoadmapStage[]): void {
  getDb()
    .prepare("UPDATE spaces SET roadmap = ?, roadmap_at = datetime('now','localtime') WHERE id = ?")
    .run(JSON.stringify({ stages }), id);
}

/** 删除空间：资料与讲解移回未分组（不级联删除学习资产），再删空间本身 */
export function deleteSpace(id: number): void {
  const db = getDb();
  db.prepare("UPDATE sources SET space_id = NULL WHERE space_id = ?").run(id);
  db.prepare("UPDATE docs SET space_id = NULL WHERE space_id = ?").run(id);
  db.prepare("DELETE FROM spaces WHERE id = ?").run(id);
}

/** 深删空间：连同其资料、讲解（深化链/追问/练习记录/复习卡）与手写卡一并删除，不可恢复。
 *  顺序遵守外键：先删引用方（asks/attempts/cards/docs）再删被引用方（sources/spaces） */
export function deleteSpaceDeep(id: number): void {
  const db = getDb();
  const docIds = (
    db.prepare("SELECT id FROM docs WHERE space_id = ?").all(id) as unknown as { id: number }[]
  ).map((r) => r.id);
  if (docIds.length > 0) {
    const placeholders = docIds.map(() => "?").join(",");
    db.prepare(`DELETE FROM asks WHERE doc_id IN (${placeholders})`).run(...docIds);
    db.prepare(`DELETE FROM attempts WHERE doc_id IN (${placeholders})`).run(...docIds);
    db.prepare(`DELETE FROM cards WHERE doc_id IN (${placeholders})`).run(...docIds);
    db.prepare(`DELETE FROM docs WHERE id IN (${placeholders})`).run(...docIds);
  }
  db.prepare("DELETE FROM cards WHERE space_id = ?").run(id); // 手写卡（doc_id 为 NULL）
  db.prepare("DELETE FROM sources WHERE space_id = ?").run(id);
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
  /** 复习卡概况（迭代 18） */
  cards: { total: number; due: number };
  /** 学习路线（迭代 22，无则为 null） */
  roadmap: RoadmapStage[] | null;
  roadmapAt: string | null;
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
    cards: cardCounts(spaceId),
    roadmap: space.roadmap,
    roadmapAt: space.roadmapAt,
  };
}
