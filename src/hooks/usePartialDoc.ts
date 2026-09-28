"use client";

import { useMemo } from "react";
import { parsePartialDoc, type PartialDoc } from "@/lib/dsl/partial";

/** 从流式累计文本派生部分文档（生成期的渐进上屏数据源） */
export function usePartialDoc(raw: string | null): PartialDoc | null {
  return useMemo(() => (raw ? parsePartialDoc(raw) : null), [raw]);
}
