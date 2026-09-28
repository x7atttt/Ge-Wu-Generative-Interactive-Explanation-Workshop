/** docs 表访问：讲解文档与其 refine 版本链 */
import { getDb } from "./index";
import { explainDocSchema, type ExplainDoc } from "@/lib/dsl/schema";

export interface DocRow {
  id: number;
  parentId: number | null;
  title: string;
  doc: ExplainDoc;
  instruction: string | null;
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
  created_at: string;
}

export function insertDoc(doc: ExplainDoc, parentId: number | null, instruction: string | null = null): number {
  const result = getDb()
    .prepare("INSERT INTO docs (parent_id, title, doc, instruction) VALUES (?, ?, ?, ?)")
    .run(parentId, doc.title, JSON.stringify(doc), instruction);
  return Number(result.lastInsertRowid);
}

export function getDoc(id: number): DocRow | null {
  const row = getDb()
    .prepare("SELECT id, parent_id, title, doc, instruction, created_at FROM docs WHERE id = ?")
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
    createdAt: row.created_at,
  };
}

export function listDocs(limit = 20): DocSummary[] {
  const rows = getDb()
    .prepare("SELECT id, title, created_at FROM docs ORDER BY id DESC LIMIT ?")
    .all(limit) as unknown as DocSummary[];
  return rows;
}
