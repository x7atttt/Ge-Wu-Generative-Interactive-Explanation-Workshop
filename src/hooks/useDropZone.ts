"use client";

import { useCallback, useRef, useState } from "react";

/**
 * 文件拖放区：挂到容器的 Drag 事件处理器 + isOver 高亮态。
 * dragenter/leave 用计数器配对（子元素间切换会成对触发，直接布尔的会闪烁）；
 * dragover 必须 preventDefault 浏览器才允许 drop。
 */
export function useDropZone(onFiles: (files: File[]) => void, enabled = true) {
  const [isOver, setIsOver] = useState(false);
  const depth = useRef(0);

  const hasFiles = (e: React.DragEvent) =>
    Array.from(e.dataTransfer?.types ?? []).includes("Files");

  const onDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!enabled || !hasFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setIsOver(true);
    },
    [enabled]
  );

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!enabled || !hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    [enabled]
  );

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setIsOver(false);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      depth.current = 0;
      setIsOver(false);
      if (!enabled) return;
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length > 0) onFiles(files);
    },
    [enabled, onFiles]
  );

  return {
    isOver,
    handlers: { onDragEnter, onDragOver, onDragLeave, onDrop },
  };
}
