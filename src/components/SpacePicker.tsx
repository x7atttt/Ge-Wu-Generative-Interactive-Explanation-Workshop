"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  createSpace,
  deleteSpace,
  moveSource,
  renameSpace,
  setSpaceExamDate,
  type SpaceInfo,
} from "@/lib/api/spaces";
import { listSources, type SourceItem } from "@/lib/api/sources";

/**
 * 工具行的「空间」切换器与管理枢纽。
 * 下拉=快速切换（全局 ↔ 各空间，选定后资料/历史/统计按空间过滤并显示概念地图）；
 * 🗂 枢纽=集中管理：空间一览（资料/讲解计数）、新建/重命名/删除、资料跨空间移动与移出。
 */
export function SpacePicker({
  spaces,
  spaceId,
  onSpacesChange,
  onChange,
  disabled,
}: {
  spaces: SpaceInfo[];
  spaceId: number | null;
  /** 空间集合变化后由父级重拉列表（并处理当前选择失效） */
  onSpacesChange: () => void;
  onChange: (spaceId: number | null) => void;
  disabled?: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hubOpen, setHubOpen] = useState(false);

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const id = await createSpace(trimmed);
      setName("");
      setCreating(false);
      onSpacesChange();
      onChange(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    }
  }

  async function handleDelete() {
    if (spaceId === null) return;
    const space = spaces.find((s) => s.id === spaceId);
    if (!space) return;
    if (!window.confirm(`删除空间「${space.name}」？资料与讲解会移回未分组，不会删除。`)) return;
    try {
      await deleteSpace(spaceId);
      onSpacesChange();
      onChange(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  }

  return (
    <div className="relative flex items-center gap-1.5">
      <select
        value={spaceId ?? ""}
        onChange={(e) => {
          const value = e.target.value;
          if (value === "__new__") setCreating(true);
          else onChange(value === "" ? null : Number(value));
        }}
        disabled={disabled}
        title="空间：资料/历史/统计按空间分组，选定后显示概念地图"
        className={`rounded-full border px-2.5 py-1 text-xs outline-none transition-colors disabled:opacity-50 ${
          spaceId !== null
            ? "border-violet-300 bg-violet-50 text-violet-700"
            : "border-zinc-200 bg-white text-zinc-600 hover:border-violet-300 focus:border-violet-400"
        }`}
      >
        <option value="">全局</option>
        {spaces.map((space) => (
          <option key={space.id} value={space.id}>
            {space.name}
          </option>
        ))}
        <option value="__new__">＋ 新建空间…</option>
      </select>
      <button
        type="button"
        onClick={() => setHubOpen((v) => !v)}
        disabled={disabled}
        title="空间管理：查看所有空间与资料归属、新建/重命名/删除/移动"
        className={`rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${
          hubOpen
            ? "border-violet-300 bg-violet-50 text-violet-700"
            : "border-zinc-200 bg-white text-zinc-500 hover:border-violet-300 hover:text-violet-600"
        }`}
      >
        🗂 空间
      </button>
      {spaceId !== null && (
        <button
          type="button"
          onClick={handleDelete}
          disabled={disabled}
          title="删除当前空间（资料与讲解移回未分组）"
          className="rounded-full border border-zinc-200 px-2 py-1 text-xs text-zinc-400 transition-colors hover:border-red-300 hover:text-red-500 disabled:opacity-50"
        >
          ✕
        </button>
      )}
      <AnimatePresence>
        {creating && (
          <motion.div
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: "auto" }}
            exit={{ opacity: 0, width: 0 }}
            className="flex items-center gap-1.5 overflow-hidden"
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              placeholder="空间名，如：期末·操作系统"
              maxLength={60}
              autoFocus
              className="w-40 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-600 outline-none focus:border-violet-400"
            />
            <button
              type="button"
              onClick={handleCreate}
              disabled={!name.trim()}
              className="rounded-full bg-violet-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
            >
              创建
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      {error && !hubOpen && <span className="text-xs text-red-500">{error}</span>}

      <AnimatePresence>
        {hubOpen && (
          <SpaceHub
            spaces={spaces}
            spaceId={spaceId}
            onError={setError}
            onSpacesChange={onSpacesChange}
            onEnter={(id) => {
              onChange(id);
              setHubOpen(false);
            }}
            onClose={() => setHubOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** 空间管理枢纽浮层：空间一览 + 资料归属管理 */
function SpaceHub({
  spaces,
  spaceId,
  onError,
  onSpacesChange,
  onEnter,
  onClose,
}: {
  spaces: SpaceInfo[];
  spaceId: number | null;
  onError: (message: string | null) => void;
  onSpacesChange: () => void;
  onEnter: (spaceId: number) => void;
  onClose: () => void;
}) {
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameText, setRenameText] = useState("");
  const [datingId, setDatingId] = useState<number | null>(null);
  const [dateText, setDateText] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [newName, setNewName] = useState("");

  const refreshSources = useCallback(async () => {
    try {
      setSources(await listSources());
    } catch {
      // 加载失败保持旧数据
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSources();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [refreshSources, onClose]);

  async function run(action: () => Promise<void>, id: number) {
    setBusyId(id);
    onError(null);
    try {
      await action();
      await refreshSources();
      onSpacesChange();
    } catch (err) {
      onError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusyId(null);
    }
  }

  async function handleCreate() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    try {
      await createSpace(trimmed);
      setNewName("");
      onSpacesChange();
    } catch (err) {
      onError(err instanceof Error ? err.message : "创建失败");
    }
  }

  const ungrouped = sources.filter((s) => s.spaceId == null);

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.16 }}
        className="absolute left-0 z-40 mt-2 w-[380px] max-w-[calc(100vw-2rem)] rounded-xl border border-zinc-200 bg-white p-3 shadow-lg"
      >
        <p className="text-xs font-semibold text-zinc-700">空间管理</p>
        <div className="mt-2 flex items-center gap-1.5">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="新建空间，如：期末·操作系统"
            maxLength={60}
            className="h-8 flex-1 rounded-lg border border-zinc-200 px-2.5 text-xs outline-none focus:border-violet-400"
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={!newName.trim()}
            className="h-8 rounded-lg bg-violet-600 px-3 text-xs font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
          >
            创建
          </button>
        </div>

        <div className="mt-2 max-h-64 overflow-y-auto">
          {spaces.length === 0 && !loading && (
            <p className="py-4 text-center text-xs text-zinc-400">还没有空间——创建一个，把一场考试的资料圈起来</p>
          )}
          {spaces.map((space) => {
            const mine = sources.filter((s) => s.spaceId === space.id);
            const current = space.id === spaceId;
            const expanded = expandedId === space.id;
            return (
              <div key={space.id} className="rounded-lg border border-zinc-100 px-2.5 py-2">
                <div className="flex items-center gap-2">
                  {renamingId === space.id ? (
                    <>
                      <input
                        value={renameText}
                        onChange={(e) => setRenameText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && renameText.trim()) {
                            run(async () => renameSpace(space.id, renameText.trim()), space.id);
                            setRenamingId(null);
                          }
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        autoFocus
                        maxLength={60}
                        className="h-7 flex-1 rounded-md border border-violet-300 px-2 text-xs outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (renameText.trim()) {
                            run(async () => renameSpace(space.id, renameText.trim()), space.id);
                            setRenamingId(null);
                          }
                        }}
                        className="text-xs text-violet-600 hover:underline"
                      >
                        保存
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => onEnter(space.id)}
                        className={`truncate text-sm hover:underline ${current ? "font-semibold text-violet-700" : "text-zinc-800"}`}
                        title="进入该空间"
                      >
                        {space.name}
                      </button>
                      {current && <span className="shrink-0 text-[10px] text-violet-500">当前</span>}
                      <span className="ml-auto shrink-0 text-[10px] text-zinc-400">
                        {space.sourceCount} 资料 · {space.docCount} 讲解
                        {space.examDate ? ` · ${space.examDate}` : ""}
                      </span>
                      <button
                        type="button"
                        disabled={busyId === space.id}
                        onClick={() => setExpandedId(expanded ? null : space.id)}
                        className="shrink-0 text-xs text-zinc-400 transition-colors hover:text-zinc-700 disabled:opacity-50"
                        title="展开资料归属"
                      >
                        {expanded ? "▾" : "▸"}
                      </button>
                      {datingId === space.id ? (
                        <span className="flex shrink-0 items-center gap-1">
                          <input
                            type="date"
                            value={dateText}
                            onChange={(e) => setDateText(e.target.value)}
                            className="h-6 rounded-md border border-violet-300 px-1 text-[10px] outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              run(
                                () => setSpaceExamDate(space.id, dateText || null),
                                space.id
                              );
                              setDatingId(null);
                            }}
                            className="text-[10px] text-violet-600 hover:underline"
                          >
                            存
                          </button>
                          <button
                            type="button"
                            onClick={() => setDatingId(null)}
                            className="text-[10px] text-zinc-400 hover:underline"
                          >
                            取消
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={busyId === space.id}
                          onClick={() => {
                            setDatingId(space.id);
                            setDateText(space.examDate ?? "");
                          }}
                          className="shrink-0 text-xs text-zinc-400 transition-colors hover:text-orange-600 disabled:opacity-50"
                          title="设置考试日期（概念地图显示倒计时）"
                        >
                          日期
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busyId === space.id}
                        onClick={() => {
                          setRenamingId(space.id);
                          setRenameText(space.name);
                        }}
                        className="shrink-0 text-xs text-zinc-400 transition-colors hover:text-violet-600 disabled:opacity-50"
                      >
                        改名
                      </button>
                      <button
                        type="button"
                        disabled={busyId === space.id}
                        onClick={() => {
                          if (window.confirm(`删除空间「${space.name}」？资料与讲解会移回未分组，不会删除。`)) {
                            run(() => deleteSpace(space.id), space.id);
                          }
                        }}
                        className="shrink-0 text-xs text-zinc-400 transition-colors hover:text-red-500 disabled:opacity-50"
                      >
                        删除
                      </button>
                    </>
                  )}
                </div>
                {expanded && (
                  <div className="mt-1.5 border-t border-zinc-100 pt-1.5">
                    {mine.length === 0 && <p className="px-1 text-[10px] text-zinc-400">空间内还没有资料</p>}
                    {mine.map((source) => (
                      <div key={source.id} className="flex items-center gap-2 py-1">
                        <span className="truncate text-xs text-zinc-600" title={source.title}>
                          {source.title}
                        </span>
                        <button
                          type="button"
                          disabled={busyId !== null}
                          onClick={() => run(() => moveSource(source.id, null), source.id)}
                          className="ml-auto shrink-0 text-[10px] text-zinc-400 transition-colors hover:text-violet-600 disabled:opacity-50"
                        >
                          移出
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {ungrouped.length > 0 && (
            <div className="mt-2 border-t border-zinc-100 pt-2">
              <p className="px-0.5 pb-1 text-[10px] text-zinc-400">未分组资料（选择移入的空间）</p>
              {ungrouped.map((source) => (
                <div key={source.id} className="flex items-center gap-2 py-1">
                  <span className="truncate text-xs text-zinc-600" title={source.title}>
                    {source.title}
                  </span>
                  <select
                    value=""
                    disabled={busyId !== null || spaces.length === 0}
                    onChange={(e) => {
                      const target = Number(e.target.value);
                      if (Number.isInteger(target) && target > 0) {
                        run(() => moveSource(source.id, target), source.id);
                      }
                    }}
                    className="ml-auto shrink-0 rounded-md border border-zinc-200 px-1.5 py-0.5 text-[10px] text-zinc-500 outline-none"
                  >
                    <option value="">移入…</option>
                    {spaces.map((space) => (
                      <option key={space.id} value={space.id}>
                        {space.name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </>
  );
}
