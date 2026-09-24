"use client";

import { useMemo } from "react";
import katex from "katex";
import { motion } from "motion/react";
import type { FormulaBlock } from "@/lib/dsl/schema";

export function FormulaBlockView({ block }: { block: FormulaBlock }) {
  const html = useMemo(() => {
    try {
      // throwOnError:false：坏 LaTeX 降级为原文显示，单块失败不拖垮整篇文档
      return katex.renderToString(block.latex, { displayMode: true, throwOnError: false });
    } catch {
      return null;
    }
  }, [block.latex]);

  return (
    <motion.figure
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl bg-zinc-50 px-4 py-5 text-center"
    >
      {html ? (
        <div className="overflow-x-auto text-lg" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <code className="text-sm text-zinc-600">{block.latex}</code>
      )}
      {block.caption ? (
        <figcaption className="mt-2 text-xs text-zinc-500">{block.caption}</figcaption>
      ) : null}
    </motion.figure>
  );
}
