"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import type { DeepenInfo } from "@/lib/dsl/deepen";
import type { Block, ExplainDoc, SliderBlock } from "@/lib/dsl/schema";
import { VarContext, type VarState } from "./var-context";
import { BlockRenderer } from "./BlockRenderer";
import { BlockSkeleton } from "./BlockSkeleton";
import { SliderControl } from "./SliderControl";

interface Entry {
  block: Block;
  i: number;
}

interface Segment {
  label: string | null;
  entries: Entry[];
}

/** 深化卡内 heading 剥离模型可能带上的"深化："前缀（分组卡 chip 已表达该语义） */
function stripDeepenPrefix(block: Block): Block {
  if (block.type === "heading") {
    return { ...block, text: block.text.replace(/^深化[：:—-]\s*/, "") };
  }
  return block;
}

/**
 * 讲解文档容器：双栏布局——主栏阅读流（滑块除外）+ 右栏 sticky 参数台（全部滑块）；
 * 窄屏滑块双渲染为内联组（置于首个可视化块前），两份 UI 共享同一变量状态。
 * deepens：多轮深化各一张分组卡；skeletonTail：生成期流式上屏的尾部骨架。
 */
export function ExplainDocView({
  doc,
  skeletonTail,
  deepens,
}: {
  doc: ExplainDoc;
  skeletonTail?: string[];
  deepens?: DeepenInfo[];
}) {
  const initialValues = useMemo(() => {
    const record: Record<string, number> = {};
    for (const block of doc.blocks) {
      if (block.type === "slider") record[block.var] = block.initial;
    }
    return record;
  }, [doc]);

  const [values, setValues] = useState(initialValues);
  useEffect(() => setValues(initialValues), [initialValues]);

  const setValue = useCallback(
    (name: string, value: number) => setValues((prev) => ({ ...prev, [name]: value })),
    []
  );

  const varState = useMemo<VarState>(() => ({ values, setValue }), [values, setValue]);

  const sliders = useMemo(
    () => doc.blocks.filter((b): b is SliderBlock => b.type === "slider"),
    [doc]
  );

  // 主栏条目：滑块除外（进参数台/内联组）
  const items = useMemo<Entry[]>(
    () => doc.blocks.map((block, i) => ({ block, i })).filter(({ block }) => block.type !== "slider"),
    [doc]
  );

  // 内联滑块组的插入位：首个可视化块之前（窄屏 fallback）
  const inlineBeforeBlockIndex = useMemo(() => {
    const entry = items.find(({ block }) => block.type === "wavePlot" || block.type === "chart");
    return entry ? entry.i : Number.POSITIVE_INFINITY;
  }, [items]);

  // 按深化边界分段：段 0 为原文，之后每段对应一轮 refine
  const segments = useMemo<Segment[]>(() => {
    const groups: Segment[] = [{ label: null, entries: [] }];
    for (const deepen of deepens ?? []) groups.push({ label: deepen.label, entries: [] });
    for (const entry of items) {
      let idx = 0;
      (deepens ?? []).forEach((deepen, k) => {
        if (entry.i >= deepen.fromIndex) idx = k + 1;
      });
      groups[idx].entries.push(entry);
    }
    return groups;
  }, [items, deepens]);

  /** 渲染一段条目：按需剥前缀、插内联滑块组，末段尾追加（无可视化块的文档） */
  const renderSegment = (segment: Entry[], isLastSegment: boolean, stripPrefix: boolean): ReactNode[] => {
    const nodes: ReactNode[] = [];
    for (const { block, i } of segment) {
      if (i === inlineBeforeBlockIndex) {
        nodes.push(<InlineSliderGroup key={`inline-${i}`} sliders={sliders} />);
      }
      nodes.push(
        <motion.div
          key={`b-${i}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 120, damping: 16 }}
        >
          <BlockRenderer block={stripPrefix ? stripDeepenPrefix(block) : block} />
        </motion.div>
      );
    }
    if (
      isLastSegment &&
      inlineBeforeBlockIndex === Number.POSITIVE_INFINITY &&
      segment.length > 0
    ) {
      nodes.push(<InlineSliderGroup key="inline-end" sliders={sliders} />);
    }
    return nodes;
  };

  const mainColumn = (
    <>
      {segments.map((segment, gi) => {
        const isLast = gi === segments.length - 1;
        if (segment.label === null) {
          return (
            <div key={gi} className="flex flex-col gap-4">
              {renderSegment(segment.entries, isLast, false)}
            </div>
          );
        }
        if (segment.entries.length === 0) {
          return (
            <div
              key={gi}
              className="rounded-xl border border-accent-100 bg-accent-50/60 px-4 py-3 text-xs text-accent-700"
            >
              深化 · {segment.label}（本次新增参数已加入参数台）
            </div>
          );
        }
        return (
          <div
            key={gi}
            className="flex flex-col gap-4 rounded-xl border border-accent-100 bg-accent-50/60 p-4"
          >
            <p className="text-xs font-medium text-accent-700">
              <span className="mr-1.5 rounded bg-accent-100 px-1.5 py-0.5">深化</span>
              {segment.label}
            </p>
            <div className="flex flex-col gap-4">
              {renderSegment(segment.entries, isLast, true)}
            </div>
          </div>
        );
      })}
      {skeletonTail && skeletonTail.length > 0 && (
        <div className="flex flex-col gap-4">
          {skeletonTail.map((type, i) => (
            <motion.div
              key={`skeleton-${i}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.7 }}
              className="rounded-xl border border-dashed border-stone-200 bg-stone-50 p-4"
            >
              <BlockSkeleton type={type} />
            </motion.div>
          ))}
        </div>
      )}
    </>
  );

  return (
    <VarContext.Provider value={varState}>
      <article className="flex flex-col gap-4">
        <motion.h2
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="font-display text-2xl font-bold tracking-wide text-stone-900"
        >
          {doc.title}
        </motion.h2>
        {sliders.length > 0 ? (
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_220px]">
            <div className="flex min-w-0 flex-col gap-4">{mainColumn}</div>
            {/* self-stretch 抵消父级 items-start 的压缩：侧栏列须占满整行高，
                否则 sticky 子元素没有滚动行程，划到下方图表时参数台"消失" */}
            <aside className="hidden self-stretch lg:block">
              {/* top-16 避开右上角固定标签组（fixed top-4，高约 45px），防止粘附时重叠 */}
              <div className="sticky top-16 flex flex-col gap-3 rounded-xl border border-stone-200 bg-stone-50 p-3">
                <p className="text-xs font-medium tracking-wide text-stone-500">参数台</p>
                {sliders.map((block) => (
                  <SliderControl key={block.var} block={block} />
                ))}
                <p className="text-[11px] leading-4 text-stone-400">
                  拖动参数，图表与公式即时反馈
                </p>
              </div>
            </aside>
          </div>
        ) : (
          <div className="flex flex-col gap-4">{mainColumn}</div>
        )}
      </article>
    </VarContext.Provider>
  );
}

/** 窄屏回落：滑块内联组（lg 以下显示），与右栏参数台共享 VarContext，拖任一份双向同步 */
function InlineSliderGroup({ sliders }: { sliders: SliderBlock[] }) {
  if (sliders.length === 0) return null;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-stone-50 p-3 lg:hidden">
      <p className="text-xs font-medium tracking-wide text-stone-500">参数台</p>
      {sliders.map((block) => (
        <SliderControl key={block.var} block={block} />
      ))}
    </div>
  );
}
