"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { deleteDoc, type DocSummary } from "@/lib/api/explanation";
import { useConfirmation } from "./ConfirmDialog";

function formatDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * 右上角「历史讲解」标签：点击展开全量记录面板，支持按标题/编号即时搜索；
 * 选中后恢复讲解并收起。当前文档高亮，失焦/Escape/点击遮罩关闭。
 * 每行可删除（级联清理深化版本、追问、练习记录与复习卡，需确认）。
 */
export function DocHistoryButton({
  docs,
  currentId,
  disabled,
  onSelect,
  onDeleted,
}: {
  docs: DocSummary[];
  currentId: number | null;
  disabled: boolean;
  onSelect: (id: number) => void;
  /** 删除成功后通知（参数为被删除的 doc id 集合，父级据此清空视图/刷新） */
  onDeleted: (deletedIds: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 批量删除模式：勾选若干篇后一次确认、逐篇级联删除
  const [batch, setBatch] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { confirm, confirmation } = useConfirmation();

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  async function handleDelete(id: number, title: string) {
    if (!await confirm({ title: `删除「${title}」`, description: "其深化版本、追问、练习记录与复习卡将一并删除，不可恢复。", confirmLabel: "删除讲解", danger: true })) return;
    setDeletingId(id);
    setError(null);
    try {
      const deleted = await deleteDoc(id);
      onDeleted(deleted);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败，请重试");
    } finally {
      setDeletingId(null);
    }
  }

  /** 批量删除：一次确认后逐篇级联删除（已不存在的按已删处理），全部结果一次性回报父级 */
  async function handleBatchDelete() {
    const ids = [...picked];
    if (ids.length === 0 || batchBusy) return;
    if (!await confirm({ title: `删除所选 ${ids.length} 篇讲解`, description: "各篇的深化版本、追问、练习记录与复习卡将一并删除，不可恢复。", confirmLabel: "删除所选讲解", danger: true })) return;
    setBatchBusy(true);
    setError(null);
    const allDeleted: number[] = [];
    try {
      for (const id of ids) {
        try {
          allDeleted.push(...(await deleteDoc(id)));
        } catch {
          allDeleted.push(id); // 已被其他路径删除的按已删对账
        }
      }
      setPicked(new Set());
      setBatch(false);
      onDeleted(allDeleted);
    } catch (err) {
      if (allDeleted.length > 0) onDeleted(allDeleted);
      setError(err instanceof Error ? err.message : "批量删除失败");
    } finally {
      setBatchBusy(false);
    }
  }

  function togglePicked(id: number) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const q = query.trim().toLowerCase();
  const filtered = q
    ? docs.filter(
        (d) => d.title.toLowerCase().includes(q) || d.versions.some(version => String(version.id).includes(q) || version.title.toLowerCase().includes(q) || version.instruction?.toLowerCase().includes(q))
      )
    : docs;

  return (
    <div className="relative">
      {confirmation}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-accent-700 disabled:cursor-not-allowed disabled:opacity-50"
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
          <span className="rounded-full bg-accent-50 px-1.5 py-px font-mono text-[10px] text-accent-600">
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
            className="absolute right-0 top-11 w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-stone-200 bg-card shadow-xl"
          >
            <div className="border-b border-stone-100 p-2">
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索标题或编号…"
                  className="min-w-0 flex-1 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700 outline-none transition-colors focus:border-accent-400 focus:bg-card"
                />
                {!batch && docs.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      setBatch(true);
                      setPicked(new Set());
                    }}
                    className="shrink-0 rounded-lg border border-stone-200 px-2.5 py-2 text-xs text-stone-500 transition-colors hover:border-red-300 hover:text-red-500"
                    title="勾选多篇后一次删除"
                  >
                    批量删除
                  </button>
                )}
              </div>
              {batch && (
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    disabled={batchBusy}
                    onClick={() =>
                      setPicked((prev) =>
                        prev.size === filtered.length
                          ? new Set()
                          : new Set(filtered.map((d) => d.id))
                      )
                    }
                    className="rounded-lg border border-stone-200 px-2 py-1 text-stone-500 transition-colors hover:border-stone-400 disabled:opacity-50"
                  >
                    {picked.size === filtered.length && filtered.length > 0 ? "清除勾选" : "全选"}
                  </button>
                  <button
                    type="button"
                    disabled={batchBusy || picked.size === 0}
                    onClick={handleBatchDelete}
                    className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 font-medium text-red-600 transition-colors hover:border-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {batchBusy ? "删除中…" : `删除所选 (${picked.size})`}
                  </button>
                  <button
                    type="button"
                    disabled={batchBusy}
                    onClick={() => {
                      setBatch(false);
                      setPicked(new Set());
                    }}
                    className="ml-auto rounded-lg px-2 py-1 text-stone-400 transition-colors hover:text-stone-700 disabled:opacity-50"
                  >
                    退出批量
                  </button>
                </div>
              )}
            </div>
            <ul className="max-h-[60vh] overflow-y-auto p-1">
              {filtered.length === 0 ? (
                <li className="px-3 py-8 text-center text-xs text-stone-400">
                  没有匹配的讲解
                </li>
              ) : (
                filtered.map((d) => (
                  <li key={d.id} className="group rounded-lg" data-history-root={d.id}>
                    <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        if (batch) {
                          togglePicked(d.id);
                          return;
                        }
                        setOpen(false);
                        onSelect(d.latestId);
                      }}
                      className={[
                        "flex min-w-0 flex-1 items-baseline gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                        batch && picked.has(d.id)
                          ? "bg-red-50 text-red-700"
                          : d.versions.some(version => version.id === currentId)
                            ? "bg-accent-50 text-accent-700"
                            : "text-stone-700 hover:bg-stone-50",
                      ].join(" ")}
                    >
                      {batch && (
                        <span
                          className={`shrink-0 self-center rounded border px-1 text-[10px] leading-4 ${
                            picked.has(d.id)
                              ? "border-red-400 bg-red-500 text-white"
                              : "border-stone-300 text-transparent"
                          }`}
                        >
                          ✓
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate">{d.title}</span>
                      <span className="shrink-0 font-mono text-[11px] text-stone-400">
                        #{d.id}
                        {d.createdAt ? ` · ${formatDay(d.createdAt)}` : ""}
                      </span>
                    </button>
                    {!batch && (
                      <button
                        type="button"
                        disabled={deletingId === d.id}
                        onClick={() => handleDelete(d.id, d.title)}
                        title="删除该讲解及其深化版本（不可恢复）"
                        className="shrink-0 rounded-lg px-2 py-2 text-xs text-stone-300 transition-colors hover:bg-red-50 hover:text-red-500 group-hover:text-stone-400 disabled:opacity-50"
                      >
                        {deletingId === d.id ? "…" : "✕"}
                      </button>
                    )}
                    </div>
                    {d.versions.length > 1 && !batch && <details className="mx-3 mb-2 border-l border-stone-200 pl-3 text-xs text-stone-500">
                      <summary className="w-fit cursor-pointer py-1.5">版本记录 · {d.versions.length} 个版本</summary>
                      <div className="flex flex-col gap-1 pb-1">
                        {d.versions.map((version, index) => <button key={version.id} type="button" aria-current={version.id === currentId ? "page" : undefined} onClick={() => { setOpen(false); onSelect(version.id); }} className={`rounded-md px-2 py-2 text-left ${version.id === currentId ? "bg-accent-50 text-accent-700" : "hover:bg-stone-100"}`}>
                          <span className="block truncate">{index === d.versions.length - 1 ? "原始讲解" : `第 ${d.versions.length - index} 版 · ${version.instruction ?? "深化讲解"}`}{index === 0 ? " · 最新" : ""}</span>
                          <span className="mt-0.5 block font-mono text-[10px] text-stone-400">#{version.id} · {formatDay(version.createdAt)}</span>
                        </button>)}
                      </div>
                    </details>}
                  </li>
                ))
              )}
            </ul>
            {error && (
              <p className="border-t border-red-100 bg-red-50 px-3 py-1.5 text-[11px] text-red-600">{error}</p>
            )}
            <div className="border-t border-stone-100 px-3 py-1.5 text-[11px] text-stone-400">
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
