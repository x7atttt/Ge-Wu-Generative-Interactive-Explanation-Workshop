"use client";

import { motion } from "motion/react";
import type { TextBlock } from "@/lib/dsl/schema";

export function TextBlockView({ block }: { block: TextBlock }) {
  return (
    <motion.p
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="leading-relaxed text-zinc-700"
    >
      {block.content}
    </motion.p>
  );
}
