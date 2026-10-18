"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import {
  deleteSource,
  extractConcepts,
  importSources,
  listSources,
  type SourceItem,
} from "@/lib/api/sources";
import { moveSource } from "@/lib/api/spaces";
import { playPop } from "@/lib/audio/sound";
import { SourceEditor } from "@/components/SourceEditor";

const KIND_LABEL: Record<string, string> = {
  txt: "TXT",
  md: "MD",
  pdf: "PDF",
  docx: "DOC",
  doc: "DOC",
};
const ACCEPT = ".txt,.md,.markdown,.pdf,.doc,.docx";
const POLL_MS = 4000;

/** MinerU 不上报页数进度的小任务兜底：显示已耗时（createdAt 为本地时间字符串） */
function elapsedSince(createdAt: string): string {
  const t = new Date(createdAt.replace(" ", "T")).getTime();
  if (!Number.isFinite(t)) return "…";
  const seconds = Math.max(0, Math.round((Date.now() - t) / 1000));
  return seconds < 60 ? ` ${seconds}s` : ` ${Math.floor(seconds / 60)}m${seconds % 60}s`;
}

/**
 * 生成入口的「资料」面板：批量导入文档（txt/md 直读，PDF/Word 走 MinerU）、
 * 状态跟踪、勾选附加（≤3 份注入生成）、一键提炼讲解点（点击概念预填生成框）。
 * 空间模式下只列本空间资料，未分组资料折叠展示并可一键移入。
 */
export function SourcesPanel({
  attachedIds,
  onAttachChange,
  onPickConcept,
  spaceId,
  spaceName,
  disabled,
  openSignal = 0,
  onChanged,
}: {
  attachedIds: number[];
  onAttachChange: (ids: number[]) => void;
  /** 点击提炼出的概念：自动附加该资料并预填概念 */
  onPickConcept: (concept: string, sourceId: number) => void;
  /** 当前空间（null = 全局模式，显示全部资料） */
  spaceId?: number | null;
  spaceName?: string;
  disabled?: boolean;
  openSignal?: number;
  onChanged: () => void;
}) {
  const [panel, setPanel] = useState({ open: false, signal: 0 });
  const open = panel.open || openSignal > panel.signal;
  const setOpen = useCallback((value: boolean) => setPanel({ open: value, signal: openSignal }), [openSignal]);
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [extractingId, setExtractingId] = useState<number | null>(null);
  const [movingId, setMovingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [tab, setTab] = useState<"current" | "ungrouped">("current");
  const [retryAction, setRetryAction] = useState<null | (() => void)>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => listSources().then((list) => {
      setSources(list);
      // 对账：附加状态里已不存在/未就绪的资料一律摘除——删除可能发生在任何路径
      // （面板删除、空间清理、外部操作），高亮的资料数必须与实际资料一致
      const valid = new Set(list.filter((s) => s.status === "ready").map((s) => s.id));
      if (attachedIds.some((id) => !valid.has(id))) {
        onAttachChange(attachedIds.filter((id) => valid.has(id)));
      }
    }).catch((err) => {
      setError(err instanceof Error ? err.message : "资料加载失败，已保留上次内容");
    }).finally(() => setLoading(false)), [attachedIds, onAttachChange]);

  // 挂载即加载一次：附加态从 localStorage 恢复后需要列表来校验有效性；
  // attachedIds 变化 → refresh 重建 → 重取列表并及时对账（收敛，无循环）
  useEffect(() => {
    refresh();
  }, [refresh]);

  // 打开时加载 + 解析中轮询（GET 惰性驱动服务端向 MinerU 同步结果）
  useEffect(() => {
    if (!open) return;
    refresh().finally(() => setLoading(false));
  }, [open, refresh, setOpen]);

  const inSpaceMode = spaceId != null;
  const visible = inSpaceMode ? sources.filter((s) => s.spaceId === spaceId) : sources;
  const ungrouped = inSpaceMode ? sources.filter((s) => s.spaceId == null) : [];
  const viewingUngrouped = inSpaceMode && tab === "ungrouped";
  const parsing = visible.some((s) => s.status === "parsing");
  useEffect(() => {
    if (!open || !parsing) return;
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [open, parsing, refresh]);

  async function handleImport(files: FileList | null) {
    if (!files || files.length === 0) return;
    setImporting(true);
    setError(null);
    try {
      await importSources([...files], spaceId ?? null);
      await refresh();
      setTab("current");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败，请重试");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleMove(id: number) {
    if (spaceId == null) return;
    setError(null); setRetryAction(null);
    setMovingId(id);
    try {
      await moveSource(id, spaceId);
      await refresh();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "移动失败");
      setRetryAction(() => () => handleMove(id));
    } finally {
      setMovingId(null);
    }
  }

  async function handleExtract(id: number) {
    setRetryAction(null);
    setExtractingId(id);
    setError(null);
    try {
      // 概念在服务端落库缓存，这里只为触发声音反馈
      const concepts = await extractConcepts(id);
      setSources((prev) => prev.map((s) => (s.id === id ? { ...s, concepts } : s)));
      await refresh(); onChanged();
      playPop();
    } catch (err) {
      setError(err instanceof Error ? err.message : "提炼失败，请稍后重试");
      setRetryAction(() => () => handleExtract(id));
    } finally {
      setExtractingId(null);
    }
  }

  async function handleDelete(id: number) {
    setError(null); setRetryAction(null);
    try {
      await deleteSource(id);
      onAttachChange(attachedIds.filter((x) => x !== id));
      await refresh();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
      setRetryAction(() => () => handleDelete(id));
    }
  }

  function toggleAttach(id: number) {
    if (attachedIds.includes(id)) {
      onAttachChange(attachedIds.filter((x) => x !== id));
    } else if (attachedIds.length < 3) {
      onAttachChange([...attachedIds, id]);
    } else {
      setError("最多附加 3 份资料");
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-pressed={attachedIds.length > 0}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition-colors disabled:opacity-50 ${
          attachedIds.length > 0
            ? "bg-accent-50 text-accent-700"
            : "text-stone-600 hover:bg-stone-100"
        }`}
        title="批量导入文档资料，生成讲解时作为事实依据"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4"><path d="m7 11 6-6a2 2 0 0 1 3 3l-7 7a3.5 3.5 0 0 1-5-5l7-7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
        资料{attachedIds.length > 0 ? ` ${attachedIds.length}` : ""}
      </button>

      <AnimatePresence>
        {open && (
          <SourcesDrawer context={inSpaceMode ? spaceName ?? "当前空间" : "全局资料"} onClose={() => setOpen(false)}>
              <div className="rounded-xl border border-dashed border-stone-300 px-4 py-6 text-center" onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); if (!importing) void handleImport(event.dataTransfer.files); }}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="mx-auto mb-3 h-6 w-6 text-secondary-600"><path d="M12 16V3m-4 4 4-4 4 4M4 14v6h16v-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                <p className="text-sm font-medium text-stone-800">添加参考资料</p>
                <p className="mt-1 text-xs text-stone-500">拖入讲义、笔记或真题</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={ACCEPT}
                  className="hidden"
                  onChange={(e) => handleImport(e.target.files)}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importing}
                  className="mt-4 min-h-9 rounded-lg bg-accent-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-accent-500 disabled:opacity-50"
                >
                  {importing ? "导入中…" : "导入文件"}
                </button>
              </div>
              <p className="mt-2 text-center text-xs text-stone-500">支持 PDF、Word、TXT、Markdown</p>
              <div className="mt-6 flex items-center gap-4 border-b border-stone-200 text-xs" role="tablist" aria-label="资料归属" onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]")];
                const index = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (tabs.indexOf(event.target as HTMLButtonElement) + (event.key === "ArrowLeft" ? -1 : 1) + tabs.length) % tabs.length;
                tabs[index]?.focus(); tabs[index]?.click();
              }}>
                <button type="button" role="tab" aria-selected={!viewingUngrouped} onClick={() => setTab("current")} className={`min-h-10 border-b-2 px-1 ${!viewingUngrouped ? "border-accent-600 font-medium text-stone-800" : "border-transparent text-stone-500"}`}>{inSpaceMode ? "当前空间" : "全部资料"} {visible.length}</button>
                {inSpaceMode && <button type="button" role="tab" aria-selected={viewingUngrouped} onClick={() => setTab("ungrouped")} className={`min-h-10 border-b-2 px-1 ${viewingUngrouped ? "border-accent-600 font-medium text-stone-800" : "border-transparent text-stone-500"}`}>未分组 {ungrouped.length}</button>}
                {loading && <span role="status" className="ml-auto text-stone-500">加载中…</span>}
              </div>

              {error && <p role="alert" className="mt-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-600">{error}<button type="button" onClick={() => { setError(null); if (retryAction) retryAction(); else refresh(); }} className="ml-2 underline">重试</button></p>}

              <div className="mt-3 space-y-3">
                {!viewingUngrouped && visible.length === 0 && !loading && (
                  <p className="py-8 text-center text-xs leading-6 text-stone-500">
                    {inSpaceMode ? (
                      <>当前空间还没有资料<br />导入文件，或从「未分组」移入已有资料。</>
                    ) : (
                      <>
                        还没有资料——导入讲义 / 笔记 / 论文，
                        <br />
                        生成时自动以它为事实依据
                      </>
                    )}
                  </p>
                )}
                {!viewingUngrouped && visible.map((source) => {
                  const attached = attachedIds.includes(source.id);
                  const ready = source.status === "ready";
                  return (
                    <div key={source.id} className="rounded-lg border border-stone-100 px-2.5 py-2">
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-medium text-stone-500">
                          {KIND_LABEL[source.kind] ?? source.kind.toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm text-stone-800" title={source.title}>
                          {source.title}
                        </span>
                        <span className="ml-auto shrink-0 text-xs">
                          {source.status === "parsing" && (
                            <span className="animate-pulse text-amber-600">
                              解析中{source.progress ? ` ${source.progress}` : elapsedSince(source.createdAt)}
                            </span>
                          )}
                          {source.status === "error" && (
                            <span className="text-red-500" title={source.error}>
                              失败
                            </span>
                          )}
                          {ready && <span className="text-emerald-600">{source.chars.toLocaleString()} 字</span>}
                        </span>
                      </div>

                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        <button type="button" disabled={!ready} onClick={() => setEditingId(source.id)} className="min-h-9 text-accent-700 underline disabled:opacity-50">查看与纠错</button>
                        <button
                          type="button"
                          disabled={!ready}
                          onClick={() => toggleAttach(source.id)}
                          className={`transition-colors disabled:cursor-default disabled:text-stone-300 ${
                            attached ? "font-medium text-accent-600" : "text-stone-500 hover:text-accent-600"
                          }`}
                        >
                          {attached ? "✓ 已附加" : "附加"}
                        </button>
                        <button
                          type="button"
                          disabled={!ready || extractingId !== null}
                          onClick={() => handleExtract(source.id)}
                          className="text-stone-500 transition-colors hover:text-accent-600 disabled:cursor-default disabled:text-stone-300"
                        >
                          {extractingId === source.id ? "提炼中…" : "提炼讲解点"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(source.id)}
                          className="ml-auto text-stone-400 transition-colors hover:text-red-500"
                        >
                          删除
                        </button>
                      </div>

                      {source.concepts.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {source.concepts.map((concept) => (
                            <button
                              key={concept}
                              type="button"
                              onClick={() => { onPickConcept(concept, source.id); setOpen(false); }}
                              className="rounded-full border border-accent-100 bg-accent-50 px-2 py-0.5 text-xs text-accent-700 transition-colors hover:border-accent-300"
                            >
                              {concept}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {viewingUngrouped && (
                  <div>
                    <p className="mb-2 text-xs leading-6 text-stone-500">{ungrouped.length > 0 ? "移入当前空间后，可作为讲解依据。" : "还没有未分组资料。"}</p>
                    {ungrouped.map((source) => (
                      <div key={source.id} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5">
                        <span className="shrink-0 rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-medium text-stone-500">
                          {KIND_LABEL[source.kind] ?? source.kind.toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm text-stone-600" title={source.title}>
                          {source.title}
                        </span>
                        <button
                          type="button"
                          disabled={movingId !== null}
                          onClick={() => handleMove(source.id)}
                          className="ml-auto shrink-0 text-xs text-secondary-500 transition-colors hover:text-secondary-700 disabled:opacity-50"
                        >
                          {movingId === source.id ? "移入中…" : "移入"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
          </SourcesDrawer>
        )}
      </AnimatePresence>
      {editingId !== null && <SourceEditor id={editingId} onClose={() => setEditingId(null)} onSaved={() => { refresh(); onChanged(); }} />}
    </div>
  );
}

function SourcesDrawer({ context, onClose, children }: { context: string; onClose: () => void; children: ReactNode }) {
  const ref = useDialogFocus<HTMLElement>();
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);
  return createPortal(<motion.div className="fixed inset-0 z-[70] flex justify-end bg-stone-900/25" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} onClick={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) onClose(); }}>
    <aside ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label="资料库" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }} className="h-dvh w-full max-w-md overflow-y-auto border-l border-stone-200 bg-card shadow-xl outline-none">
      <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-stone-100 bg-card px-6 py-5">
        <div><h2 className="font-display text-xl font-semibold text-stone-900">资料库</h2><p className="mt-1 break-words text-xs text-stone-500">{context} · 参考资料</p></div>
        <button type="button" onClick={onClose} aria-label="关闭资料" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-stone-600 hover:bg-stone-100"><svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4"><path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></button>
      </div>
      <div className="p-6">{children}</div>
    </aside>
  </motion.div>, document.body);
}
