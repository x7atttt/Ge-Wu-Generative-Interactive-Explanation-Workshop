"use client";

import { motion } from "motion/react";
import type { HeadingBlock } from "@/lib/dsl/schema";

export function HeadingBlockView({ block }: { block: HeadingBlock }) {
  const Tag = block.level === 2 ? "h3" : "h4";
  const size = block.level === 2 ? "text-lg" : "text-base";
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="pt-2">
      <Tag className={`${size} font-semibold text-zinc-900`}>{block.text}</Tag>
    </motion.div>
  );
}
