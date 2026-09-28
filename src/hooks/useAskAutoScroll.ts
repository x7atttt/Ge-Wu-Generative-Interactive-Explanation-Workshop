"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

interface AutoScrollOptions {
  /** 是否处于流式输出中 */
  active: boolean;
  /** 最后一轮内容长度（触发 layout pin 的依赖） */
  contentLength: number;
  /** 条目数量 */
  itemCount: number;
}

/**
 * 问答区粘底滚动：直接赋值 pin + lastPinned 哨兵检测用户上移 + 手势主动释放 + 距底重吸。
 * 前置条件：容器需要 CSS `overflow-anchor: none`，否则浏览器原生滚动锚定会与 pin 冲突。
 */
export function useAskAutoScroll({ active, contentLength, itemCount }: AutoScrollOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);

  const pin = useCallback(() => {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // 条目/内容变化时同步 pin（layout 阶段生效，防闪烁）
  useLayoutEffect(() => {
    if (pinnedRef.current) pin();
  }, [pin, itemCount, contentLength, active]);

  // 流式期 rAF 逐帧 pin；lastPinned 哨兵：scrollTop 低于上次 pin 4px 即用户上移 → 释放。
  // 没有哨兵时逐帧 pin 下 scrollTop 恒为底部，用户上移永远检测不到。
  useEffect(() => {
    if (!active) return;
    const el = containerRef.current;
    if (!el) return;
    let raf = 0;
    let lastPinned: number | null = null;
    const tick = () => {
      raf = 0;
      if (!pinnedRef.current) return;
      if (lastPinned !== null && el.scrollTop < lastPinned - 4) {
        pinnedRef.current = false;
        return;
      }
      el.scrollTop = el.scrollHeight;
      lastPinned = el.scrollTop;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [active]);

  // 手势主动释放 + 距底 <80px 重新吸附
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const release = () => {
      pinnedRef.current = false;
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) release();
    };
    let touchY = 0;
    const onTouchStart = (event: TouchEvent) => {
      touchY = event.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY ?? 0;
      if (y - touchY > 4) release();
      touchY = y;
    };
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      pinnedRef.current = distance < 80;
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("scroll", onScroll);
    };
  }, []);

  return { containerRef };
}
