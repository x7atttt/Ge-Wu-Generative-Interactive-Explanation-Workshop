"use client";

import { motion, useReducedMotion } from "motion/react";

/**
 * 答对标志：SVG 勾描画（笔画从 0 画到 1）+ 轻微弹入。
 * reduced-motion 降级为纯淡入（保留颜色语义，去掉运动）。
 */
export function CheckDraw({
  size = 18,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 26 }}
      className={`inline-flex align-middle text-emerald-500 ${className}`}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
        <motion.path
          d="M4.5 12.5l5 5 10-11"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: reduce ? 1 : 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.32, ease: "easeOut" }}
        />
      </svg>
    </motion.span>
  );
}
