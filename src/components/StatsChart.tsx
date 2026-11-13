"use client";

import type { EChartsCoreOption } from "echarts/core";
import { useEChart } from "@/components/useEChart";

export function StatsChart({ option }: { option: EChartsCoreOption }) {
  const containerRef = useEChart(option);
  return <div ref={containerRef} className="h-40 w-full" />;
}
