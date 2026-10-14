/** 前端 API 调用层：空间（复习战役容器）与概念地图 */

import type { ConceptStatus } from "@/lib/db/spaces";

export interface SpaceInfo {
  id: number;
  name: string;
  note: string;
  examDate: string | null;
  createdAt: string;
  /** 枢纽面板用计数 */
  sourceCount: number;
  docCount: number;
}

export interface ConceptState {
  text: string;
  sourceIds: number[];
  docIds: number[];
  status: ConceptStatus;
  practice: { total: number; correct: number };
}

export interface SpaceMap {
  space: SpaceInfo;
  concepts: ConceptState[];
  summary: { sources: number; explained: number; weak: number };
}

async function readError(res: Response): Promise<Error> {
  const data: unknown = await res.json().catch(() => null);
  return new Error(
    data && typeof data === "object" && "error" in data && typeof data.error === "string"
      ? data.error
      : `请求失败（${res.status}）`
  );
}

export async function listSpaces(): Promise<SpaceInfo[]> {
  const res = await fetch("/api/spaces");
  if (!res.ok) throw await readError(res);
  const data = (await res.json()) as { spaces: SpaceInfo[] };
  return data.spaces;
}

export async function createSpace(name: string, note = ""): Promise<number> {
  const res = await fetch("/api/spaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, note }),
  });
  if (!res.ok) throw await readError(res);
  const data = (await res.json()) as { id: number };
  return data.id;
}

export async function deleteSpace(id: number): Promise<void> {
  const res = await fetch(`/api/spaces/${id}`, { method: "DELETE" });
  if (!res.ok) throw await readError(res);
}

export async function renameSpace(id: number, name: string): Promise<void> {
  const res = await fetch(`/api/spaces/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw await readError(res);
}

export async function getSpaceMap(id: number): Promise<SpaceMap> {
  const res = await fetch(`/api/spaces/${id}/map`);
  if (!res.ok) throw await readError(res);
  return (await res.json()) as SpaceMap;
}

/** 资料移入空间（null = 移回未分组） */
export async function moveSource(id: number, spaceId: number | null): Promise<void> {
  const res = await fetch(`/api/sources/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spaceId }),
  });
  if (!res.ok) throw await readError(res);
}
