import assert from "node:assert/strict";
import test from "node:test";

type RangeModule = {
  rangeStartDate(latestDate: string, range: "1M" | "6M" | "YTD" | "1Y" | "5Y" | "10Y" | "15Y"): string;
  selectPriceRange<T extends { date: string }>(points: T[], range: "1M" | "6M" | "YTD" | "1Y" | "5Y" | "10Y" | "15Y"): T[];
};

const loadPriceRange = async (): Promise<RangeModule | null> => {
  try {
    return await import(
      new URL("../app/dashboard/stock-chart-range.ts", import.meta.url).href,
    ) as RangeModule;
  } catch (error) {
    if (error instanceof Error && /Cannot find module|ERR_MODULE_NOT_FOUND/.test(error.message)) {
      return null;
    }
    throw error;
  }
};

test("derives Yahoo-like EOD windows without requesting intraday data", async () => {
  const priceRange = await loadPriceRange();
  assert.ok(priceRange, "the reusable EOD chart-range module must exist");
  if (!priceRange) return;

  assert.equal(priceRange.rangeStartDate("2026-07-20", "1M"), "2026-06-20");
  assert.equal(priceRange.rangeStartDate("2026-07-20", "6M"), "2026-01-20");
  assert.equal(priceRange.rangeStartDate("2026-07-20", "YTD"), "2026-01-01");
  assert.equal(priceRange.rangeStartDate("2026-07-20", "5Y"), "2021-07-20");

  const visible = priceRange.selectPriceRange([
    { date: "2025-12-31", value: 1 },
    { date: "2026-01-01", value: 2 },
    { date: "2026-07-20", value: 3 },
  ], "YTD");
  assert.deepEqual(visible.map((point) => point.date), ["2026-01-01", "2026-07-20"]);
});
