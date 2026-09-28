"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import type { ExplainDoc } from "@/lib/dsl/schema";
import { VarContext, type VarState } from "./var-context";
import { BlockRenderer } from "./BlockRenderer";
import { BlockSkeleton } from "./BlockSkeleton";

/**
 * 讲解文档容器：管理滑块变量值域，按块顺序渲染。
 * skeletonTail：生成期流式上屏时，已解析真块之后待产出的骨架占位。
 */
export function ExplainDocView({
  doc,
  skeletonTail,
}: {
  doc: ExplainDoc;
  skeletonTail?: string[];
}) {
  const initialValues = useMemo(() => {
    const record: Record<string, number> = {};
    for (const block of doc.blocks) {
      if (block.type === "slider") record[block.var] = block.initial;
    }
    return record;
  }, [doc]);

  const [values, setValues] = useState(initialValues);
  // refine 后文档对象变化时重置变量域
  useEffect(() => setValues(initialValues), [initialValues]);

  const setValue = useCallback(
    (name: string, value: number) => setValues((prev) => ({ ...prev, [name]: value })),
    []
  );

  const varState = useMemo<VarState>(() => ({ values, setValue }), [values, setValue]);

  return (
    <VarContext.Provider value={varState}>
      <article className="flex flex-col gap-4">
        <motion.h2
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-xl font-semibold text-zinc-900"
        >
          {doc.title}
        </motion.h2>
        {doc.blocks.map((block, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * i, type: "spring", stiffness: 120, damping: 16 }}
          >
            <BlockRenderer block={block} />
          </motion.div>
        ))}
        {skeletonTail && skeletonTail.length > 0 && (
          <div className="flex flex-col gap-4">
            {skeletonTail.map((type, i) => (
              <motion.div
                key={`skeleton-${i}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.7 }}
                className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4"
              >
                <BlockSkeleton type={type} />
              </motion.div>
            ))}
          </div>
        )}
      </article>
    </VarContext.Provider>
  );
}
