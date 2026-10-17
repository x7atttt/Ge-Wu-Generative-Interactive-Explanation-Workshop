/** 前端 API 调用层：空间（复习战役容器）与概念地图 */

import type { ConceptStatus, RoadmapStage } from "@/lib/db/spaces";

export interface SpaceInfo {
  id: number;
  name: string;
  note: string;
  examDate: string | null;
  roadmap: RoadmapStage[] | null;
  roadmapAt: string | null;
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
  /** 复习卡概况（迭代 18） */
  cards: { total: number; due: number };
  /** 学习路线（迭代 22，无则为 null） */
  roadmap: RoadmapStage[] | null;
  roadmapAt: string | null;
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

/** 删除空间。withContent=true 连同其资料/讲解/练习/复习卡深删（不可恢复）；
 *  缺省仅删空间本身，资料与讲解移回未分组 */
export async function deleteSpace(id: number, withContent = false): Promise<void> {
  const res = await fetch(`/api/spaces/${id}${withContent ? "?content=1" : ""}`, {
    method: "DELETE",
  });
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

/** 设置/清除考试日期（YYYY-MM-DD 或 null，倒计时锚点） */
export async function setSpaceExamDate(id: number, examDate: string | null): Promise<void> {
  const res = await fetch(`/api/spaces/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ examDate }),
  });
  if (!res.ok) throw await readError(res);
}

/** 设置空间备注（科目/范围说明，地图头部展示） */
export async function setSpaceNote(id: number, note: string): Promise<void> {
  const res = await fetch(`/api/spaces/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note }),
  });
  if (!res.ok) throw await readError(res);
}

export async function getSpaceMap(id: number): Promise<SpaceMap> {
  const res = await fetch(`/api/spaces/${id}/map`);
  if (!res.ok) throw await readError(res);
  return (await res.json()) as SpaceMap;
}

/** 生成/覆盖学习路线（空间概念按依赖与难度编排，概念名白名单对齐） */
export async function generateRoadmap(id: number): Promise<RoadmapStage[]> {
  const res = await fetch(`/api/spaces/${id}/roadmap`, { method: "POST" });
  if (!res.ok) throw await readError(res);
  return ((await res.json()) as { roadmap: RoadmapStage[] }).roadmap;
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
