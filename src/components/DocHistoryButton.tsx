"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { DocSummary } from "@/lib/api/explanation";

function formatDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * 右上角「历史讲解」标签：点击展开全量记录面板，支持按标题/编号即时搜索；
 * 选中后恢复讲解并收起。当前文档高亮，失焦/Escape/点击遮罩关闭。
 */
export function DocHistoryButton({
  docs,
  currentId,
  disabled,
  onSelect,
}: {
  docs: DocSummary[];
  currentId: number | null;
  disabled: boolean;
  onSelect: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? docs.filter(
        (d) => d.title.toLowerCase().includes(q) || String(d.id).includes(q)
      )
    : docs;

  return (
    <div className="fixed right-4 top-4 z-40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white/90 px-3 py-1.5 text-xs font-medium text-zinc-600 shadow-sm backdrop-blur transition-colors hover:border-indigo-300 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="h-3.5 w-3.5"
          aria-hidden
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        历史讲解
        {docs.length > 0 && (
          <span className="rounded-full bg-indigo-50 px-1.5 py-px font-mono text-[10px] text-indigo-600">
            {docs.length}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 320, damping: 26 }}
            className="absolute right-0 top-11 w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl"
          >
            <div className="border-b border-zinc-100 p-2">
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索标题或编号…"
                className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 outline-none transition-colors focus:border-indigo-400 focus:bg-white"
              />
            </div>
            <ul className="max-h-[60vh] overflow-y-auto p-1">
              {filtered.length === 0 ? (
                <li className="px-3 py-8 text-center text-xs text-zinc-400">
                  没有匹配的讲解
                </li>
              ) : (
                filtered.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onSelect(d.id);
                      }}
                      className={[
                        "flex w-full items-baseline gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                        d.id === currentId
                          ? "bg-indigo-50 text-indigo-700"
                          : "text-zinc-700 hover:bg-zinc-50",
                      ].join(" ")}
                    >
                      <span className="min-w-0 flex-1 truncate">{d.title}</span>
                      <span className="shrink-0 font-mono text-[11px] text-zinc-400">
                        #{d.id}
                        {d.createdAt ? ` · ${formatDay(d.createdAt)}` : ""}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
            <div className="border-t border-zinc-100 px-3 py-1.5 text-[11px] text-zinc-400">
              共 {docs.length} 篇
              {q && filtered.length !== docs.length ? ` · 匹配 ${filtered.length} 篇` : ""}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 展开时的点击关闭遮罩（盖住页面但不盖标签与面板） */}
      {open && (
        <div className="fixed inset-0 -z-10" onClick={() => setOpen(false)} aria-hidden />
      )}
    </div>
  );
}
