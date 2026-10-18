"use client";

import { useEffect, useRef } from "react";

/** 限制键盘焦点留在当前模态层，退出后还给触发入口。 */
export function useDialogFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.focus();
    function trap(e: KeyboardEvent) {
      if (e.key !== "Tab" || !panel) return;
      const nodes = [...panel.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], summary, [tabindex='0']")]
        .filter((el) => el.getClientRects().length > 0);
      const first = nodes[0]; const last = nodes[nodes.length - 1];
      if (!first) { e.preventDefault(); panel.focus(); return; }
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || document.activeElement === panel)) { e.preventDefault(); first.focus(); }
    }
    panel.addEventListener("keydown", trap);
    return () => { panel.removeEventListener("keydown", trap); if (previous?.isConnected) previous.focus(); };
  }, []);
  return ref;
}
