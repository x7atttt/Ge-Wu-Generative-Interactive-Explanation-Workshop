import type { ExamGrade, ExamSession } from "@/lib/db/exams";
export type { ExamGrade, ExamSession };

async function request<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined ? undefined : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `请求失败（${res.status}）`);
  return data as T;
}

export async function listExams(spaceId: number): Promise<ExamSession[]> {
  return (await request<{ sessions: ExamSession[] }>(`/api/exams?spaceId=${spaceId}`)).sessions;
}

export async function startExam(spaceId: number): Promise<ExamSession> {
  return (await request<{ session: ExamSession }>("/api/exams", { spaceId })).session;
}

export async function getExam(id: string): Promise<ExamSession> {
  return (await request<{ session: ExamSession }>(`/api/exams/${id}`)).session;
}

export async function answerExam(id: string, cardId: number, grade: ExamGrade): Promise<ExamSession> {
  return (await request<{ session: ExamSession }>(`/api/exams/${id}/answers`, { cardId, grade })).session;
}
