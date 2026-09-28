"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 流式文本平滑显示：target 即时累积为真值，rAF 每帧按剩余量的 1/6（至少 1 字符）
 * 指数追赶显示——先快后慢，追平即停帧。解决 SSE delta 突发成块上屏的顿挫感。
 */
export function useSmoothStreamText() {
  const targetRef = useRef("");
  const displayRef = useRef("");
  const [display, setDisplay] = useState("");
  const rafRef = useRef(0);

  const tick = useCallback(() => {
    rafRef.current = 0;
    const target = targetRef.current;
    if (displayRef.current.length >= target.length) return;
    const step = Math.max(1, Math.ceil((target.length - displayRef.current.length) / 6));
    displayRef.current = target.slice(0, displayRef.current.length + step);
    setDisplay(displayRef.current);
    if (displayRef.current.length < targetRef.current.length) {
      rafRef.current = requestAnimationFrame(tick);
    }
  }, []);

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  const append = useCallback(
    (text: string) => {
      targetRef.current += text;
      if (!rafRef.current) rafRef.current = requestAnimationFrame(tick);
    },
    [tick]
  );

  /** 直接设定目标（props 驱动场景：每次渲染传入全量文本） */
  const setTarget = useCallback(
    (text: string) => {
      targetRef.current = text;
      if (!rafRef.current) rafRef.current = requestAnimationFrame(tick);
    },
    [tick]
  );

  const reset = useCallback(() => {
    targetRef.current = "";
    displayRef.current = "";
    setDisplay("");
  }, []);

  return { display, append, setTarget, reset };
}
