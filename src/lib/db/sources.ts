/** sources 表访问：导入的文档资料（统一为 Markdown，作为讲解生成的事实依据） */
import { getDb } from "./index";

export type SourceKind = "txt" | "md" | "pdf" | "docx" | "doc";
export type SourceStatus = "parsing" | "ready" | "error";

/** 列表/面板用摘要（不含 md_content，避免列表接口拖大响应） */
export interface SourceSummary {
  id: number;
  title: string;
  kind: SourceKind;
  status: SourceStatus;
  chars: number;
  concepts: string[];
  error: string;
  /** 解析进度（如 "3/12 页"），仅 parsing 期间有值 */
  progress: string;
  createdAt: string;
}

interface RawRow {
  id: number;
  title: string;
  kind: string;
  status: string;
  md_content: string;
  chars: number;
  concepts: string;
  error: string;
  progress: string;
  batch_id: string;
  file_name: string;
  created_at: string;
}

export interface SourceRow extends SourceSummary {
  mdContent: string;
  batchId: string;
  fileName: string;
}

function toRow(raw: RawRow): SourceRow {
  let concepts: string[] = [];
  try {
    const parsed = JSON.parse(raw.concepts || "[]");
    if (Array.isArray(parsed)) {
      concepts = parsed.filter((c): c is string => typeof c === "string" && !!c.trim());
    }
  } catch {
    // 损坏的缓存视为未提炼
  }
  return {
    id: raw.id,
    title: raw.title,
    kind: raw.kind as SourceKind,
    status: raw.status as SourceStatus,
    mdContent: raw.md_content,
    chars: raw.chars,
    concepts,
    error: raw.error,
    progress: raw.progress ?? "",
    batchId: raw.batch_id,
    fileName: raw.file_name,
    createdAt: raw.created_at,
  };
}

/** 新建资料：txt/md 直接 ready；pdf/word 先 parsing 等 MinerU 回填；提交即失败的可直接落 error */
export function insertSource(input: {
  title: string;
  kind: SourceKind;
  status: SourceStatus;
  mdContent?: string;
  error?: string;
  batchId?: string;
  fileName?: string;
}): number {
  const md = input.mdContent ?? "";
  const result = getDb()
    .prepare(
      "INSERT INTO sources (title, kind, status, md_content, chars, error, batch_id, file_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      input.title,
      input.kind,
      input.status,
      md,
      md.length,
      (input.error ?? "").slice(0, 300),
      input.batchId ?? "",
      input.fileName ?? ""
    );
  return Number(result.lastInsertRowid);
}

const SELECT_ALL =
  "SELECT id, title, kind, status, md_content, chars, concepts, error, progress, batch_id, file_name, created_at FROM sources";

export function getSource(id: number): SourceRow | null {
  const row = getDb()
    .prepare(`${SELECT_ALL} WHERE id = ?`)
    .get(id) as unknown as RawRow | undefined;
  return row ? toRow(row) : null;
}

export function listSources(limit = 200): SourceRow[] {
  const rows = getDb()
    .prepare(`${SELECT_ALL} ORDER BY id DESC LIMIT ?`)
    .all(limit) as unknown as RawRow[];
  return rows.map(toRow);
}

/** 面板列表：剥离正文 */
export function listSourceSummaries(limit = 200): SourceSummary[] {
  return listSources(limit).map(
    ({ mdContent: _md, batchId: _b, fileName: _f, ...rest }) => rest
  );
}

/** 解析完成回填（幂等：仅 parsing 状态的行接受回填，防并发轮询重复写入；进度随终态清空） */
export function completeSource(id: number, mdContent: string): void {
  getDb()
    .prepare(
      "UPDATE sources SET status = 'ready', md_content = ?, chars = ?, error = '', progress = '' WHERE id = ? AND status = 'parsing'"
    )
    .run(mdContent, mdContent.length, id);
}

export function failSource(id: number, message: string): void {
  getDb()
    .prepare(
      "UPDATE sources SET status = 'error', error = ?, progress = '' WHERE id = ? AND status = 'parsing'"
    )
    .run(message.slice(0, 300), id);
}

/** 解析进度展示（如 "3/12 页"）：仅 parsing 行更新，终态写入时清空 */
export function setSourceProgress(id: number, progress: string): void {
  getDb()
    .prepare("UPDATE sources SET progress = ? WHERE id = ? AND status = 'parsing'")
    .run(progress.slice(0, 60), id);
}

export function setSourceConcepts(id: number, concepts: string[]): void {
  getDb()
    .prepare("UPDATE sources SET concepts = ? WHERE id = ?")
    .run(JSON.stringify(concepts), id);
}

export function deleteSource(id: number): void {
  getDb().prepare("DELETE FROM sources WHERE id = ?").run(id);
}

/** 生成时按 id 批量取 ready 资料（顺序稳定按传入 id） */
export function getReadySources(ids: number[]): SourceRow[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = getDb()
    .prepare(`${SELECT_ALL} WHERE id IN (${placeholders}) AND status = 'ready'`)
    .all(...ids) as unknown as RawRow[];
  const byId = new Map(rows.map(toRow).map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id)).filter((row): row is SourceRow => !!row);
}
