"use client";

import { motion } from "motion/react";
import type { TextBlock } from "@/lib/dsl/schema";
import { MarkdownView } from "./MarkdownView";

export function TextBlockView({ block }: { block: TextBlock }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="leading-relaxed text-stone-700"
    >
      <MarkdownView content={block.content} />
    </motion.div>
  );
}
