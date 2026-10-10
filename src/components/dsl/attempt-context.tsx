"use client";

import { createContext, useContext } from "react";

export type AttemptBlockType = "quiz" | "fillBlank" | "match" | "sort";

/**
 * 练习判定上报通道：page 在文档已落库（docId 存在）时提供。
 * 组件在"检查/判定"时机调用 report；Provider 缺失（流式期/未落库）时静默不上报。
 */
export interface AttemptReporter {
  docId: number;
  report: (blockType: AttemptBlockType, correct: boolean) => void;
}

export const AttemptContext = createContext<AttemptReporter | null>(null);

export function useAttempt(): AttemptReporter | null {
  return useContext(AttemptContext);
}

/** fire-and-forget 上报：任何失败静默吞掉，绝不打断练习交互 */
export function postAttempt(docId: number, blockType: AttemptBlockType, correct: boolean): void {
  fetch("/api/attempts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ docId, blockType, correct }),
    keepalive: true,
  }).catch(() => {});
}
