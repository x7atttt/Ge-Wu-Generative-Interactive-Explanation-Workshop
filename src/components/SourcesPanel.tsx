"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  deleteSource,
  extractConcepts,
  importSources,
  listSources,
  type SourceItem,
} from "@/lib/api/sources";
import { moveSource } from "@/lib/api/spaces";
import { playPop } from "@/lib/audio/sound";

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
  disabled,
}: {
  attachedIds: number[];
  onAttachChange: (ids: number[]) => void;
  /** 点击提炼出的概念：自动附加该资料并预填概念 */
  onPickConcept: (concept: string, sourceId: number) => void;
  /** 当前空间（null = 全局模式，显示全部资料） */
  spaceId?: number | null;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [extractingId, setExtractingId] = useState<number | null>(null);
  const [movingId, setMovingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setSources(await listSources());
    } catch {
      // 列表加载失败不打断面板，保持旧数据
    }
  }, []);

  // 打开时加载 + 解析中轮询（GET 惰性驱动服务端向 MinerU 同步结果）
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    refresh().finally(() => setLoading(false));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, refresh]);

  const inSpaceMode = spaceId != null;
  const visible = inSpaceMode ? sources.filter((s) => s.spaceId === spaceId) : sources;
  const ungrouped = inSpaceMode ? sources.filter((s) => s.spaceId == null) : [];
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败，请重试");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleMove(id: number) {
    if (spaceId == null) return;
    setMovingId(id);
    try {
      await moveSource(id, spaceId);
      await refresh();
    } catch {
      refresh();
    } finally {
      setMovingId(null);
    }
  }

  async function handleExtract(id: number) {
    setExtractingId(id);
    setError(null);
    try {
      // 概念在服务端落库缓存，这里只为触发声音反馈
      const concepts = await extractConcepts(id);
      setSources((prev) => prev.map((s) => (s.id === id ? { ...s, concepts } : s)));
      playPop();
    } catch (err) {
      setError(err instanceof Error ? err.message : "提炼失败，请稍后重试");
    } finally {
      setExtractingId(null);
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteSource(id);
      onAttachChange(attachedIds.filter((x) => x !== id));
      await refresh();
    } catch {
      // 删除失败刷新一次列表看实际状态
      refresh();
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
        onClick={() => setOpen((v) => !v)}
        aria-pressed={attachedIds.length > 0}
        disabled={disabled}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-50 ${
          attachedIds.length > 0
            ? "border-indigo-300 bg-indigo-50 text-indigo-600"
            : "border-zinc-200 text-zinc-400 hover:text-zinc-600"
        }`}
        title="批量导入文档资料，生成讲解时作为事实依据"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${attachedIds.length > 0 ? "bg-indigo-500" : "bg-zinc-300"}`} />
        资料{attachedIds.length > 0 ? ` ${attachedIds.length}` : ""}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16 }}
              className="absolute right-0 z-40 mt-2 w-[380px] max-w-[calc(100vw-2rem)] rounded-xl border border-zinc-200 bg-white p-3 shadow-lg"
            >
              <div className="flex items-center gap-2">
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
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
                >
                  {importing ? "导入中…" : "导入文件"}
                </button>
                <p className="text-xs text-zinc-400">txt / md 本地解析 · PDF / Word 走 MinerU</p>
                <span className="ml-auto text-xs text-zinc-300">{loading ? "加载中…" : ""}</span>
              </div>

              {error && <p className="mt-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-600">{error}</p>}

              <div className="mt-2 max-h-72 overflow-y-auto">
                {visible.length === 0 && !loading && (
                  <p className="py-6 text-center text-xs leading-5 text-zinc-400">
                    {inSpaceMode ? (
                      <>本空间还没有资料——点「导入文件」，或把下方未分组资料移入</>
                    ) : (
                      <>
                        还没有资料——导入讲义 / 笔记 / 论文，
                        <br />
                        生成时自动以它为事实依据
                      </>
                    )}
                  </p>
                )}
                {visible.map((source) => {
                  const attached = attachedIds.includes(source.id);
                  const ready = source.status === "ready";
                  return (
                    <div key={source.id} className="rounded-lg border border-zinc-100 px-2.5 py-2">
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">
                          {KIND_LABEL[source.kind] ?? source.kind.toUpperCase()}
                        </span>
                        <span className="truncate text-sm text-zinc-800" title={source.title}>
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

                      <div className="mt-1.5 flex items-center gap-3 text-xs">
                        <button
                          type="button"
                          disabled={!ready}
                          onClick={() => toggleAttach(source.id)}
                          className={`transition-colors disabled:cursor-default disabled:text-zinc-300 ${
                            attached ? "font-medium text-indigo-600" : "text-zinc-500 hover:text-indigo-600"
                          }`}
                        >
                          {attached ? "✓ 已附加" : "附加"}
                        </button>
                        <button
                          type="button"
                          disabled={!ready || extractingId !== null}
                          onClick={() => handleExtract(source.id)}
                          className="text-zinc-500 transition-colors hover:text-indigo-600 disabled:cursor-default disabled:text-zinc-300"
                        >
                          {extractingId === source.id ? "提炼中…" : "提炼讲解点"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(source.id)}
                          className="ml-auto text-zinc-400 transition-colors hover:text-red-500"
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
                              onClick={() => onPickConcept(concept, source.id)}
                              className="rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700 transition-colors hover:border-indigo-300"
                            >
                              {concept}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {ungrouped.length > 0 && (
                  <div className="mt-2 border-t border-zinc-100 pt-2">
                    <p className="px-0.5 pb-1 text-[10px] text-zinc-400">
                      未分组资料（点「移入」加入本空间）
                    </p>
                    {ungrouped.map((source) => (
                      <div key={source.id} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5">
                        <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">
                          {KIND_LABEL[source.kind] ?? source.kind.toUpperCase()}
                        </span>
                        <span className="truncate text-sm text-zinc-500" title={source.title}>
                          {source.title}
                        </span>
                        <button
                          type="button"
                          disabled={movingId !== null}
                          onClick={() => handleMove(source.id)}
                          className="ml-auto shrink-0 text-xs text-violet-500 transition-colors hover:text-violet-700 disabled:opacity-50"
                        >
                          {movingId === source.id ? "移入中…" : "移入"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
