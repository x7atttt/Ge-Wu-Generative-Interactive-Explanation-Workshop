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

/**
 * 讲解文档容器：双栏布局——主栏阅读流（滑块除外）+ 右栏 sticky 参数台（全部滑块）；
 * 窄屏滑块双渲染为内联组（置于首个可视化块前），两份 UI 共享同一变量状态。
 * deepen：refine 新增段的分组渲染；skeletonTail：生成期流式上屏的尾部骨架。
 */
export function ExplainDocView({
  doc,
  skeletonTail,
  deepen,
}: {
  doc: ExplainDoc;
  skeletonTail?: string[];
  deepen?: DeepenInfo | null;
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
    const entry = items.find(
      ({ block }) => block.type === "wavePlot" || block.type === "chart"
    );
    return entry ? entry.i : Number.POSITIVE_INFINITY;
  }, [items]);

  const preSegment = useMemo(
    () => (deepen ? items.filter((e) => e.i < deepen.fromIndex) : items),
    [items, deepen]
  );
  const deepSegment = useMemo(
    () => (deepen ? items.filter((e) => e.i >= deepen.fromIndex) : []),
    [items, deepen]
  );

  /** 渲染一段主栏条目；末段按需在段尾追加内联滑块组（无可视化块的文档） */
  const renderSegment = (segment: Entry[], isLastSegment: boolean): ReactNode[] => {
    const nodes: ReactNode[] = segment.map(({ block, i }) => {
      const wrappers: ReactNode[] = [];
      if (i === inlineBeforeBlockIndex) {
        wrappers.push(<InlineSliderGroup key={`inline-${i}`} sliders={sliders} />);
      }
      wrappers.push(
        <motion.div
          key={`b-${i}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 120, damping: 16 }}
        >
          <BlockRenderer block={block} />
        </motion.div>
      );
      return wrappers;
    });
    if (
      isLastSegment &&
      inlineBeforeBlockIndex === Number.POSITIVE_INFINITY &&
      segment.length > 0
    ) {
      nodes.push(<InlineSliderGroup key="inline-end" sliders={sliders} />);
    }
    return nodes.flat();
  };

  const mainColumn = (
    <>
      {renderSegment(preSegment, deepSegment.length === 0)}
      {deepen && deepSegment.length > 0 && (
        <div className="flex flex-col gap-4 rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
          <p className="text-xs font-medium text-indigo-700">
            <span className="mr-1.5 rounded bg-indigo-100 px-1.5 py-0.5">深化</span>
            {deepen.label}
          </p>
          {renderSegment(deepSegment, true)}
        </div>
      )}
      {deepen && deepSegment.length === 0 && (
        <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-xs text-indigo-700">
          深化 · {deepen.label}（本次新增参数已加入参数台）
        </div>
      )}
      {skeletonTail && skeletonTail.length > 0 && (
        <div className="flex flex-col gap-4">
          {skeletonTail.map((type, i) => (
            <motion.div
              key={`skeleton-${i}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.7 }}
              className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4"
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
          className="text-xl font-semibold text-zinc-900"
        >
          {doc.title}
        </motion.h2>
        {sliders.length > 0 ? (
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_220px]">
            <div className="flex min-w-0 flex-col gap-4">{mainColumn}</div>
            <aside className="hidden lg:block">
              <div className="sticky top-6 flex flex-col gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-xs font-medium tracking-wide text-zinc-500">参数台</p>
                {sliders.map((block) => (
                  <SliderControl key={block.var} block={block} />
                ))}
                <p className="text-[11px] leading-4 text-zinc-400">
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
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 lg:hidden">
      <p className="text-xs font-medium tracking-wide text-zinc-500">参数台</p>
      {sliders.map((block) => (
        <SliderControl key={block.var} block={block} />
      ))}
    </div>
  );
}
