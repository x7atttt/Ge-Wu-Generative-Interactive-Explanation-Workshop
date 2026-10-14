"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { createSpace, deleteSpace, type SpaceInfo } from "@/lib/api/spaces";

/**
 * 工具行的「空间」切换器：全局 ↔ 各空间；内联新建与删除。
 * 选定空间后：资料/历史/统计按空间过滤，主栏出现概念地图。
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
  /** 新建/删除后由父级重拉空间列表（并处理当前选择失效） */
  onSpacesChange: () => void;
  onChange: (spaceId: number | null) => void;
  disabled?: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

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
    <div className="flex items-center gap-1.5">
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
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  );
}
