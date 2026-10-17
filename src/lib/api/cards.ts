/** 前端 API 调用层：FSRS 复习卡 */
import type { ReviewGrade } from "@/lib/fsrs";

export interface ReviewCard {
  id: number;
  docId: number;
  originConcept: string | null;
  front: string;
  back: string;
  difficulty: number;
  stability: number;
  lastReview: string | null;
  intervalDays: number;
  repetitions: number;
  due: string;
}

async function readError(res: Response): Promise<Error> {
  const data: unknown = await res.json().catch(() => null);
  return new Error(
    data && typeof data === "object" && "error" in data && typeof data.error === "string"
      ? data.error
      : `请求失败（${res.status}）`
  );
}

export async function listDueCards(spaceId: number): Promise<ReviewCard[]> {
  const res = await fetch(`/api/cards?spaceId=${spaceId}`);
  if (!res.ok) throw await readError(res);
  const data = (await res.json()) as { cards: ReviewCard[] };
  return data.cards;
}

/** 综合测验抽卷（空间全部卡随机抽样，count 上限缺省 20） */
export async function getExamCards(spaceId: number, count?: number): Promise<ReviewCard[]> {
  const query = count !== undefined ? `&count=${count}` : "";
  const res = await fetch(`/api/cards/exam?spaceId=${spaceId}${query}`);
  if (!res.ok) throw await readError(res);
  const data = (await res.json()) as { cards: ReviewCard[] };
  return data.cards;
}

/** 从讲解提取复习卡；返回新增/跳过数 */
export async function makeCardsFromDoc(docId: number): Promise<{ added: number; skipped: number }> {
  const res = await fetch("/api/cards/from-doc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ docId }),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { added: number; skipped: number };
}

export async function reviewCard(id: number, grade: ReviewGrade): Promise<ReviewCard> {
  const res = await fetch(`/api/cards/${id}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grade }),
  });
  if (!res.ok) throw await readError(res);
  const data = (await res.json()) as { card: ReviewCard };
  return data.card;
}

export async function clearCards(spaceId: number): Promise<void> {
  const res = await fetch(`/api/cards?spaceId=${spaceId}`, { method: "DELETE" });
  if (!res.ok) throw await readError(res);
}

/** 空间全部卡（管理面板用，含未到期与手写卡） */
export async function listAllCards(spaceId: number): Promise<ReviewCard[]> {
  const res = await fetch(`/api/cards?spaceId=${spaceId}&all=1`);
  if (!res.ok) throw await readError(res);
  const data = (await res.json()) as { cards: ReviewCard[] };
  return data.cards;
}

/** 手写新卡（concept 可空） */
export async function createCard(input: {
  spaceId: number;
  front: string;
  back: string;
  concept?: string;
}): Promise<ReviewCard> {
  const res = await fetch("/api/cards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await readError(res);
  return ((await res.json()) as { card: ReviewCard }).card;
}

/** 批量导入：每行「题面 | 答案 | 概念(可选)」 */
export async function importCardsBatch(
  spaceId: number,
  text: string
): Promise<{ added: number; skipped: number; invalidLines: number[] }> {
  const res = await fetch("/api/cards/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spaceId, text }),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { added: number; skipped: number; invalidLines: number[] };
}

/** 单张编辑：题面/答案/概念归属（不传的字段不动） */
export async function updateCard(
  id: number,
  input: { front?: string; back?: string; concept?: string }
): Promise<ReviewCard> {
  const res = await fetch(`/api/cards/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await readError(res);
  return ((await res.json()) as { card: ReviewCard }).card;
}

export async function deleteCard(id: number): Promise<void> {
  const res = await fetch(`/api/cards/${id}`, { method: "DELETE" });
  if (!res.ok) throw await readError(res);
}
