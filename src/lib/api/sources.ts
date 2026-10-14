/** 前端 API 调用层：文档资料库（导入/列表/删除/概念提炼） */

export type SourceKind = "txt" | "md" | "pdf" | "docx" | "doc";
export type SourceStatus = "parsing" | "ready" | "error";

export interface SourceItem {
  id: number;
  title: string;
  kind: SourceKind;
  status: SourceStatus;
  chars: number;
  concepts: string[];
  error: string;
  /** 解析进度（如 "3/12 页"），仅 parsing 期间有值 */
  progress: string;
  /** 所属空间（null = 未分组） */
  spaceId: number | null;
  createdAt: string;
}

async function readError(res: Response): Promise<Error> {
  const data: unknown = await res.json().catch(() => null);
  return new Error(
    data && typeof data === "object" && "error" in data && typeof data.error === "string"
      ? data.error
      : `请求失败（${res.status}）`
  );
}

export async function listSources(): Promise<SourceItem[]> {
  const res = await fetch("/api/sources");
  if (!res.ok) throw await readError(res);
  const data = (await res.json()) as { sources: SourceItem[] };
  return data.sources;
}

/** 批量导入：txt/md 服务端直读，pdf/doc/docx 走 MinerU 异步解析（返回行含 parsing 态）；spaceId 归属空间 */
export async function importSources(files: File[], spaceId: number | null): Promise<SourceItem[]> {
  const form = new FormData();
  for (const file of files) form.append("files", file);
  if (spaceId !== null) form.append("spaceId", String(spaceId));
  const res = await fetch("/api/sources", { method: "POST", body: form });
  if (!res.ok) throw await readError(res);
  const data = (await res.json()) as { sources: SourceItem[] };
  return data.sources;
}

export async function deleteSource(id: number): Promise<void> {
  const res = await fetch(`/api/sources/${id}`, { method: "DELETE" });
  if (!res.ok) throw await readError(res);
}

/** 一键提炼讲解点：服务端有缓存时直接返回缓存 */
export async function extractConcepts(id: number): Promise<string[]> {
  const res = await fetch(`/api/sources/${id}/concepts`, { method: "POST" });
  if (!res.ok) throw await readError(res);
  const data = (await res.json()) as { concepts: string[] };
  return data.concepts;
}
