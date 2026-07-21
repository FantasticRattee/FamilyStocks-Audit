import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStockAnalysis,
  isSafeAnalyzerTicker,
  type StockAnalysisInput,
} from "../app/dashboard/stock-analyzer";

const input: StockAnalysisInput = {
  ticker: "MSFT",
  currency: "USD",
  fetchedAt: "2026-07-21T00:00:00.000Z",
  prices: [
    { date: "2011-07-01", close: 100, adjustedClose: 100 },
    { date: "2016-07-01", close: 160, adjustedClose: 200 },
    { date: "2021-07-01", close: 300, adjustedClose: 400 },
    { date: "2026-06-30", close: 390, adjustedClose: 780 },
    { date: "2026-07-01", close: 400, adjustedClose: 800 },
    { date: "2026-07-02", close: 410, adjustedClose: 820 },
  ],
  trailingPe: [
    { date: "2021-12-31", value: 31.2 },
    { date: "2022-12-30", value: 25.5 },
    { date: "2023-12-29", value: -2 },
    { date: "2024-12-31", value: 28.7 },
  ],
};

test("derives adjusted monthly and annual averages, CAGRs, and annual P/E", () => {
  const analysis = buildStockAnalysis(input);

  assert.equal(analysis.currentPrice, 410);
  assert.equal(analysis.monthlyAverages.at(-1)?.adjustedAverage, 810);
  assert.equal(analysis.annualAverages.at(-1)?.adjustedAverage, 800);
  assert.ok(Math.abs((analysis.cagr.totalReturn[5] ?? 0) - 0.154) < 0.002);
  assert.ok(Math.abs((analysis.cagr.totalReturn[10] ?? 0) - 0.152) < 0.002);
  assert.equal(analysis.annualPe.find((point) => point.year === 2022)?.value, 25.5);
  assert.equal(analysis.annualPe.find((point) => point.year === 2023)?.value, null);
  assert.match(analysis.forwardPe.status, /point-in-time/i);
});

test("rejects unsafe or unsupported ticker input before a provider request", () => {
  assert.equal(isSafeAnalyzerTicker("GOOGL"), true);
  assert.equal(isSafeAnalyzerTicker("BRK.B"), true);
  assert.equal(isSafeAnalyzerTicker("GOOGL;DROP TABLE"), false);
  assert.equal(isSafeAnalyzerTicker(""), false);
});
