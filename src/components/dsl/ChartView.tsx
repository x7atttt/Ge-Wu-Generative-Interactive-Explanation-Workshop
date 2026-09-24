"use client";

import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { ChartBlock } from "@/lib/dsl/schema";
import { resolveSlot, useVars } from "./var-context";

// 按需注册：只打包用到的图表类型，控制首屏体积（AGENTS 规范）
echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

function useEChart(option: echarts.EChartsCoreOption) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current);
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  return containerRef;
}

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
    return {
      tooltip: { trigger: "axis" },
      ...(block.series.length > 1
        ? { legend: { bottom: 0, icon: "roundRect", itemWidth: 12, itemHeight: 6 } }
        : {}),
      grid: { left: 44, right: 16, top: 28, bottom: block.series.length > 1 ? 40 : 28 },
      xAxis: { type: "category", data: block.categories ?? [] },
      yAxis: { type: "value" },
      series: block.series.map((serie) => ({
        name: serie.name,
        type: block.chartType,
        data: serie.data.map((slot) => resolveSlot(slot, values)),
      })),
    };
  }, [block, values]);

  const containerRef = useEChart(option);

  return (
    <figure className="rounded-xl border border-zinc-200 p-3">
      <div ref={containerRef} className="h-64 w-full" />
      {block.title ? (
        <figcaption className="pt-1 text-center text-xs text-zinc-500">{block.title}</figcaption>
      ) : null}
    </figure>
  );
}
