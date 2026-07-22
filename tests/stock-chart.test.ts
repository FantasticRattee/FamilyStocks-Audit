import assert from "node:assert/strict";
import test from "node:test";

type ChartPoint = { label: string; value: number };

type ChartModule = {
  buildLineChartGeometry(points: ChartPoint[]): {
    coordinates: Array<{ point: ChartPoint; x: number; y: number }>;
    xTicks: Array<{ label: string; x: number }>;
    yTicks: Array<{ value: number; y: number }>;
    width: number;
    plotLeft: number;
    plotRight: number;
    yAxisX: number;
  };
  nearestLineChartPointIndex(input: {
    clientX: number;
    rectLeft: number;
    rectWidth: number;
    geometry: ReturnType<ChartModule["buildLineChartGeometry"]>;
  }): number;
};

const loadStockChart = async (): Promise<ChartModule | null> => {
  try {
    return await import(
      new URL("../app/dashboard/stock-chart.ts", import.meta.url).href,
    ) as ChartModule;
  } catch (error) {
    if (error instanceof Error && /Cannot find module|ERR_MODULE_NOT_FOUND/.test(error.message)) {
      return null;
    }
    throw error;
  }
};

const points: ChartPoint[] = [
  { label: "2025-07-21", value: 100 },
  { label: "2025-10-21", value: 180 },
  { label: "2026-01-21", value: 140 },
  { label: "2026-04-21", value: 240 },
  { label: "2026-07-20", value: 200 },
];

test("maps dates horizontally, prices vertically, and exposes month labels", async () => {
  const stockChart = await loadStockChart();
  assert.ok(stockChart, "the reusable stock-chart geometry module must exist");
  if (!stockChart) return;

  const geometry = stockChart.buildLineChartGeometry(points);
  assert.equal(geometry.coordinates[0]?.point.label, "2025-07-21");
  assert.ok((geometry.coordinates[0]?.x ?? 0) < (geometry.coordinates.at(-1)?.x ?? 0));
  assert.ok((geometry.coordinates[3]?.y ?? Infinity) < (geometry.coordinates[0]?.y ?? -Infinity));
  assert.match(geometry.xTicks[0]?.label ?? "", /Jul 2025/);
  assert.match(geometry.xTicks.at(-1)?.label ?? "", /Jul 2026/);
  assert.equal(geometry.yTicks.length, 3);
  assert.ok((geometry.yTicks[0]?.value ?? 0) > (geometry.yTicks.at(-1)?.value ?? Infinity));
  assert.ok(geometry.yAxisX > geometry.plotRight, "the numeric price scale belongs on the right");
  assert.ok(geometry.yAxisX < geometry.width, "the right-side price scale stays inside the viewbox");
});

test("maps a hover position to the nearest chronological observation", async () => {
  const stockChart = await loadStockChart();
  assert.ok(stockChart, "the reusable stock-chart geometry module must exist");
  if (!stockChart) return;

  const geometry = stockChart.buildLineChartGeometry(points);
  const middleX = geometry.plotLeft + ((geometry.plotRight - geometry.plotLeft) * 0.5);
  const hoveredIndex = stockChart.nearestLineChartPointIndex({
    clientX: middleX,
    rectLeft: 0,
    rectWidth: geometry.width,
    geometry,
  });

  assert.equal(hoveredIndex, 2);
});
