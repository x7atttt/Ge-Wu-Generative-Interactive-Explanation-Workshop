"use client";

import { useReducedMotion } from "motion/react";

/**
 * 答题反馈动效预设：全站统一语言（cohesion），reduced-motion 统一在此门控。
 * SHAKE 用模块级常量保持引用稳定——motion 对相同引用的 keyframes 不会重放。
 */
export const SHAKE = { x: [0, -4, 4, -2, 2, 0] };
export const SHAKE_IDLE = { x: 0 };
export const SHAKE_TRANSITION = { duration: 0.3 };

export const POP_KEYFRAMES = { scale: [1, 1.04, 1] };
export const POP_IDLE = { scale: 1 };
export const POP_TRANSITION = { duration: 0.25, ease: "easeOut" as const };

/** 判定反馈动效组合（正确弹一下 / 错误轻晃；减少动态时全部静止，只留颜色） */
export function useFeedbackMotion() {
  const reduce = useReducedMotion();
  return {
    pop: reduce ? POP_IDLE : POP_KEYFRAMES,
    popIdle: POP_IDLE,
    popTransition: POP_TRANSITION,
    shake: reduce ? SHAKE_IDLE : SHAKE,
    shakeIdle: SHAKE_IDLE,
    shakeTransition: SHAKE_TRANSITION,
  };
}
