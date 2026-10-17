"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import {
  createCard,
  deleteCard,
  listAllCards,
  updateCard,
  type ReviewCard,
} from "@/lib/api/cards";
import { playPop } from "@/lib/audio/sound";

/** 卡片调度状态的小字摘要（稳定度 = 记忆率降到 90% 的预估天数） */
function schedText(card: ReviewCard): string {
  if (card.stability > 0) {
    const s = card.stability >= 10 ? String(Math.round(card.stability)) : card.stability.toFixed(1);
    return `稳定度 ${s} 天 · 下次 ${card.due}`;
  }
  return "新卡 · 今日";
}

/**
 * 卡片管理面板：空间全部复习卡（提取 + 手写）的查看/手写补充/单张编辑/删除。
 * 概念归属可改，直接决定综合测验的分项口径。
 */
export function CardManagerPanel({
  spaceId,
  concepts,
  onClose,
  onChanged,
}: {
  spaceId: number;
  /** 概念建议（来自概念地图，datalist 候选） */
  concepts: string[];
  onClose: () => void;
  /** 卡数变化后刷新地图计数 */
  onChanged: () => void;
}) {
  const [cards, setCards] = useState<ReviewCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [concept, setConcept] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editFront, setEditFront] = useState("");
  const [editBack, setEditBack] = useState("");
  const [editConcept, setEditConcept] = useState("");

  const refresh = useCallback(async () => {
    try {
      setCards(await listAllCards(spaceId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "卡片列表加载失败");
    }
  }, [spaceId]);

  useEffect(() => {
    refresh();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [refresh, onClose]);

  async function handleAdd() {
    const f = front.trim();
    const b = back.trim();
    if (!f || !b || busy) return;
    setBusy(true);
    try {
      await createCard({ spaceId, front: f, back: b, concept: concept.trim() });
      setFront("");
      setBack("");
      playPop();
      await refresh();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "添加失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveEdit(id: number) {
    const f = editFront.trim();
    const b = editBack.trim();
    if (!f || !b || busy) return;
    setBusy(true);
    try {
      await updateCard(id, { front: f, back: b, concept: editConcept.trim() });
      setEditingId(null);
      playPop();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(card: ReviewCard) {
    if (!window.confirm(`删除这张卡？\n${card.front.slice(0, 60)}`)) return;
    setBusy(true);
    try {
      await deleteCard(card.id);
      await refresh();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setBusy(false);
    }
  }

  // 按概念分组保持列表顺序（SQL 已按概念聚拢，这里只做展示分组）
  const groups = new Map<string, ReviewCard[]>();
  for (const card of cards ?? []) {
    const key = card.originConcept?.trim() || "未分概念";
    const list = groups.get(key) ?? [];
    list.push(card);
    groups.set(key, list);
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-stone-900/30" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 14, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 160, damping: 18 }}
          className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-2xl border border-stone-200 bg-card p-5 shadow-xl"
        >
          <div className="flex items-center gap-2">
            <h3 className="font-display text-base font-bold text-stone-900">
              🗂 卡片管理{cards !== null ? ` · ${cards.length} 张` : ""}
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="ml-auto rounded-full border border-stone-200 px-2 py-0.5 text-xs text-stone-400 transition-colors hover:text-stone-700"
            >
              关闭
            </button>
          </div>

          {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}

          {/* 手写新增：错题/讲义要点直接进卡池（复习与测验共用） */}
          <div className="mt-3 rounded-xl border border-stone-100 bg-stone-50/60 p-3">
            <p className="text-xs font-medium text-stone-600">手写补充</p>
            <input
              value={concept}
              onChange={(e) => setConcept(e.target.value)}
              list="card-concept-options"
              placeholder="概念归属（可选，决定测验分项）"
              maxLength={120}
              className="mt-2 w-full rounded-lg border border-stone-200 bg-card px-2.5 py-1.5 text-xs outline-none focus:border-secondary-400"
            />
            <datalist id="card-concept-options">
              {concepts.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <textarea
              value={front}
              onChange={(e) => setFront(e.target.value)}
              placeholder="题面（如：死锁的四个必要条件是什么？）"
              rows={2}
              maxLength={2000}
              className="mt-2 w-full resize-y rounded-lg border border-stone-200 bg-card px-2.5 py-1.5 text-xs outline-none focus:border-secondary-400"
            />
            <textarea
              value={back}
              onChange={(e) => setBack(e.target.value)}
              placeholder="答案（翻面后显示的内容）"
              rows={2}
              maxLength={2000}
              className="mt-2 w-full resize-y rounded-lg border border-stone-200 bg-card px-2.5 py-1.5 text-xs outline-none focus:border-secondary-400"
            />
            <button
              type="button"
              onClick={handleAdd}
              disabled={busy || !front.trim() || !back.trim()}
              className="mt-2 rounded-lg bg-secondary-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-secondary-500 disabled:opacity-50"
            >
              添加（新卡今日进入复习队列）
            </button>
          </div>

          <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
            {cards === null && <p className="py-8 text-center text-sm text-stone-400">加载卡片…</p>}
            {cards !== null && cards.length === 0 && (
              <p className="py-8 text-center text-sm leading-6 text-stone-500">
                还没有卡片
                <br />
                <span className="text-xs text-stone-400">
                  在讲解底部「制成复习卡」自动提取，或用上方表单手写
                </span>
              </p>
            )}
            {[...groups.entries()].map(([group, list]) => (
              <div key={group} className="mb-3">
                <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-stone-500">
                  {group}
                  <span className="text-stone-300">{list.length}</span>
                </p>
                {list.map((card) =>
                  editingId === card.id ? (
                    <div key={card.id} className="mb-1.5 rounded-xl border border-secondary-200 bg-secondary-50/40 p-2.5">
                      <input
                        value={editConcept}
                        onChange={(e) => setEditConcept(e.target.value)}
                        list="card-concept-options"
                        placeholder="概念归属（留空 = 未分概念）"
                        maxLength={120}
                        className="w-full rounded-lg border border-stone-200 bg-card px-2.5 py-1.5 text-xs outline-none focus:border-secondary-400"
                      />
                      <textarea
                        value={editFront}
                        onChange={(e) => setEditFront(e.target.value)}
                        rows={2}
                        maxLength={2000}
                        className="mt-1.5 w-full resize-y rounded-lg border border-stone-200 bg-card px-2.5 py-1.5 text-xs outline-none focus:border-secondary-400"
                      />
                      <textarea
                        value={editBack}
                        onChange={(e) => setEditBack(e.target.value)}
                        rows={2}
                        maxLength={2000}
                        className="mt-1.5 w-full resize-y rounded-lg border border-stone-200 bg-card px-2.5 py-1.5 text-xs outline-none focus:border-secondary-400"
                      />
                      <div className="mt-1.5 flex gap-2">
                        <button
                          type="button"
                          disabled={busy || !editFront.trim() || !editBack.trim()}
                          onClick={() => handleSaveEdit(card.id)}
                          className="rounded-lg bg-secondary-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-secondary-500 disabled:opacity-50"
                        >
                          保存
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="rounded-lg border border-stone-200 px-3 py-1 text-xs text-stone-500 transition-colors hover:text-stone-800"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div key={card.id} className="group mb-1.5 rounded-xl border border-stone-100 px-3 py-2">
                      <p className="line-clamp-2 text-xs leading-5 text-stone-800">{card.front}</p>
                      <p className="mt-0.5 line-clamp-1 text-[10px] text-stone-400" title={card.back}>
                        {card.back}
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-[10px] text-stone-300">{schedText(card)}</span>
                        <span className="ml-auto flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setEditingId(card.id);
                              setEditFront(card.front);
                              setEditBack(card.back);
                              setEditConcept(card.originConcept ?? "");
                            }}
                            className="text-[10px] text-stone-400 transition-colors hover:text-secondary-600 disabled:opacity-50"
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleDelete(card)}
                            className="text-[10px] text-stone-400 transition-colors hover:text-red-500 disabled:opacity-50"
                          >
                            删除
                          </button>
                        </span>
                      </div>
                    </div>
                  )
                )}
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </>
  );
}
