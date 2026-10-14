/**
 * SM-2 间隔重复调度（日粒度）。算法依据：SuperMemo-2（Wozniak 1990），
 * 设计论证见 ../reference.md 三节「间隔重复算法」行。
 * 三档评分（对应经典 q 值）：again=1 忘记 / fuzzy=3 模糊 / easy=5 记得。
 */

export type ReviewGrade = "again" | "fuzzy" | "easy";

const GRADE_Q: Record<ReviewGrade, number> = { again: 1, fuzzy: 3, easy: 5 };

export function gradeQ(grade: ReviewGrade): number {
  return GRADE_Q[grade];
}

/** 本地日期 YYYY-MM-DD */
export function localDay(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + Math.max(0, Math.round(days)));
  return localDay(d);
}

export interface SrsState {
  ease: number;
  intervalDays: number;
  repetitions: number;
}

export interface SrsNext extends SrsState {
  /** 下次到期日（本地日期） */
  due: string;
}

/** SM-2 核心：EF 更新 + 复习次数与间隔递进。q<3 重置次数、当天再现 */
export function schedule(state: SrsState, grade: ReviewGrade, today = localDay()): SrsNext {
  const q = GRADE_Q[grade];
  const ease = Math.max(1.3, state.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));

  if (q < 3) {
    // 忘记：重置进度，仍留在今日队列（日粒度下的"当场再记一遍"）
    return { ease, intervalDays: 0, repetitions: 0, due: today };
  }

  const repetitions = state.repetitions + 1;
  const intervalDays =
    repetitions === 1 ? 1 : repetitions === 2 ? 6 : Math.round(state.intervalDays * ease);
  return { ease, intervalDays, repetitions, due: addDays(today, intervalDays) };
}
