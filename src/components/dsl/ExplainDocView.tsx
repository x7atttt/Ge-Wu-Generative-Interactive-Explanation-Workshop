"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import type { ExplainDoc } from "@/lib/dsl/schema";
import { VarContext, type VarState } from "./var-context";
import { BlockRenderer } from "./BlockRenderer";

/**
 * 讲解文档容器：管理滑块变量值域，按块顺序渲染。
 * 离散状态切换（进出场、步骤编排）用 spring；拖拽类直接操作不经过这里。
 */
export function ExplainDocView({ doc }: { doc: ExplainDoc }) {
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
      </article>
    </VarContext.Provider>
  );
}
