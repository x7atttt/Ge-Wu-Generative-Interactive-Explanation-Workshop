/** docs 表访问：讲解文档与其 refine 版本链 */
import { getDb } from "./index";
import { explainDocSchema, type ExplainDoc } from "@/lib/dsl/schema";

export interface DocRow {
  id: number;
  parentId: number | null;
  title: string;
  doc: ExplainDoc;
  instruction: string | null;
  /** 所属空间（null = 全局散装讲解）；refine 子版本继承父版本 */
  spaceId: number | null;
  /** 出身概念：从空间概念地图/资料提炼点生成时记录，地图据此对齐状态 */
  originConcept: string | null;
  /** 生成时附加的资料 id（JSON 数组），概念地图点击概念时复用 */
  sourceIds: number[];
  createdAt: string;
}

export interface DocSummary {
  id: number;
  title: string;
  createdAt: string;
}

interface RawRow {
  id: number;
  parent_id: number | null;
  title: string;
  doc: string;
  instruction: string | null;
  space_id: number | null;
  origin_concept: string | null;
  source_ids: string;
  created_at: string;
}

/** 讲解的"出身"：生成请求携带的空间与概念上下文 */
export interface DocOrigin {
  spaceId: number | null;
  originConcept: string | null;
  sourceIds?: number[];
}

function parseSourceIds(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.filter((v): v is number => typeof v === "number") : [];
  } catch {
    return [];
  }
}

export function insertDoc(
  doc: ExplainDoc,
  parentId: number | null,
  instruction: string | null = null,
  origin: DocOrigin = { spaceId: null, originConcept: null }
): number {
  const result = getDb()
    .prepare(
      "INSERT INTO docs (parent_id, title, doc, instruction, space_id, origin_concept, source_ids) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      parentId,
      doc.title,
      JSON.stringify(doc),
      instruction,
      origin.spaceId,
      origin.originConcept,
      JSON.stringify(origin.sourceIds ?? [])
    );
  return Number(result.lastInsertRowid);
}

export function getDoc(id: number): DocRow | null {
  const row = getDb()
    .prepare(
      "SELECT id, parent_id, title, doc, instruction, space_id, origin_concept, source_ids, created_at FROM docs WHERE id = ?"
    )
    .get(id) as unknown as RawRow | undefined;
  if (!row) return null;
  // 防御：损坏/不合法的行直接视为不存在
  let doc: ExplainDoc;
  try {
    const parsed = explainDocSchema.safeParse(JSON.parse(row.doc));
    if (!parsed.success) return null;
    doc = parsed.data;
  } catch {
    return null;
  }
  return {
    id: row.id,
    parentId: row.parent_id,
    title: row.title,
    doc,
    instruction: row.instruction,
    spaceId: row.space_id,
    originConcept: row.origin_concept,
    sourceIds: parseSourceIds(row.source_ids),
    createdAt: row.created_at,
  };
}

/** 空间内概念地图：取空间下带出身概念的讲解（refine 子版本同概念并列出现，状态取最好） */
export function listDocsBySpace(spaceId: number): Pick<DocRow, "id" | "title" | "originConcept" | "sourceIds">[] {
  const rows = getDb()
    .prepare(
      "SELECT id, title, origin_concept, source_ids FROM docs WHERE space_id = ? AND origin_concept IS NOT NULL"
    )
    .all(spaceId) as unknown as {
    id: number;
    title: string;
    origin_concept: string | null;
    source_ids: string;
  }[];
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    originConcept: row.origin_concept,
    sourceIds: parseSourceIds(row.source_ids),
  }));
}

export function listDocs(limit = 500, spaceId?: number): DocSummary[] {
  const rows =
    spaceId !== undefined
      ? (getDb()
          .prepare("SELECT id, title, created_at FROM docs WHERE space_id = ? ORDER BY id DESC LIMIT ?")
          .all(spaceId, limit) as unknown as { id: number; title: string; created_at: string }[])
      : (getDb()
          .prepare("SELECT id, title, created_at FROM docs ORDER BY id DESC LIMIT ?")
          .all(limit) as unknown as { id: number; title: string; created_at: string }[]);
  return rows.map((row) => ({ id: row.id, title: row.title, createdAt: row.created_at }));
}
