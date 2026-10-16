/** 前端 API 调用层：SM-2 复习卡 */
import type { ReviewGrade } from "@/lib/srs";

export interface ReviewCard {
  id: number;
  docId: number;
  originConcept: string | null;
  front: string;
  back: string;
  ease: number;
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
