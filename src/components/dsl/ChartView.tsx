"use client";

import { useMemo } from "react";
import type * as echarts from "echarts/core";
import type { ChartBlock } from "@/lib/dsl/schema";
import { useEChart } from "@/components/useEChart";
import { resolveSlot, useVars } from "./var-context";

export function ChartView({ block }: { block: ChartBlock }) {
  const { values } = useVars();

  const option = useMemo<echarts.EChartsCoreOption>(() => {
    if (block.chartType === "pie") {
      // pie 只有单系列语义：取第一系列，categories 作为扇区名
      const data = block.series[0].data.map((slot, i) => ({
        name: block.categories?.[i] ?? `项 ${i + 1}`,
        value: resolveSlot(slot, values),
      }));
      return {
        tooltip: { trigger: "item" },
        series: [{ type: "pie", radius: ["38%", "64%"], data }],
      };
    }
    // 有名字的系列就常驻显示图例（单系列也一样）：系列名如 "x = r·cos θ" 是关键信息，
    // 只在悬停 tooltip 里出现会被误读为图例且不悬停就看不到
    const namedCount = block.series.filter((s) => s.name).length;
    // 纵轴语义标签（数量级/等级→文字）：数值刻度按 yLabels 替换，数据层保持数字可比
    const yLabels = block.yLabels ?? {};
    const hasYLabels = Object.keys(yLabels).length > 0;
    return {
      tooltip: { trigger: "axis" },
      ...(namedCount > 0
        ? {
            legend: {
              bottom: 0,
              icon: "roundRect",
              itemWidth: 12,
              itemHeight: 6,
              textStyle: { color: "#78716c", fontSize: 11 },
            },
          }
        : {}),
      grid: { left: hasYLabels ? 76 : 44, right: 16, top: 28, bottom: namedCount > 0 ? 40 : 28 },
      xAxis: { type: "category", data: block.categories ?? [] },
      yAxis: {
        type: "value",
        ...(hasYLabels
          ? { axisLabel: { formatter: (value: number) => yLabels[String(value)] ?? String(value) } }
          : {}),
      },
      series: block.series.map((serie) => ({
        name: serie.name,
        type: block.chartType,
        // 采样点连成的函数曲线用轻度平滑，缓解折角失真；离散对比数据也适用
        ...(block.chartType === "line" ? { smooth: 0.3 } : {}),
        data: serie.data.map((slot) => resolveSlot(slot, values)),
      })),
    };
  }, [block, values]);

  const containerRef = useEChart(option);

  return (
    <figure className="rounded-xl border border-stone-200 p-3">
      <div ref={containerRef} className="h-64 w-full" />
      {block.title ? (
        <figcaption className="pt-1 text-center text-xs text-stone-500">{block.title}</figcaption>
      ) : null}
    </figure>
  );
}
