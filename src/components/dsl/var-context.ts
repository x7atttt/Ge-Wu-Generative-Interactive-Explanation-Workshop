"use client";

import { createContext, useContext } from "react";
import type { NumberSlot } from "@/lib/dsl/schema";

export interface VarState {
  values: Record<string, number>;
  setValue: (name: string, value: number) => void;
}

/** 滑块变量值的作用域：ExplainDocView 提供，块组件消费 */
export const VarContext = createContext<VarState | null>(null);

export function useVars(): VarState {
  const ctx = useContext(VarContext);
  if (!ctx) throw new Error("useVars 必须在 ExplainDocView 内使用");
  return ctx;
}

/** 解析数值槽：常量直接返回，变量引用查当前值（缺失时回退 0 保证可渲染） */
export function resolveSlot(slot: NumberSlot, values: Record<string, number>): number {
  if (typeof slot === "number") return slot;
  return values[slot.$var] ?? 0;
}
