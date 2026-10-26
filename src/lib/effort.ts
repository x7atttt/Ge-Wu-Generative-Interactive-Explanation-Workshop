export const EFFORTS = ["low", "high", "max"] as const;
export type ReasoningEffort = (typeof EFFORTS)[number];
export const EFFORT_STORAGE_KEY = "gewu-reasoning-effort";

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && EFFORTS.some(effort => effort === value);
}
