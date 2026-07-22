import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

test("exposes a separate cached Stock Analyzer route without placing provider secrets in the client", async () => {
  const [page, dashboard, styles] = await Promise.all([
    readFile(new URL("../app/analyzer/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/StockAnalyzerDashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /StockAnalyzerDashboard/);
  assert.match(dashboard, /\/api\/analyzer\?symbol=/);
  assert.match(dashboard, /\/api\/analyzer\/refresh/);
  assert.match(dashboard, /PRICE_CHART_RANGES/);
  assert.match(dashboard, /Historical Forward P\/E/);
  assert.match(dashboard, /searchUsSymbolHints/);
  assert.match(dashboard, /placeholder="Search U\.S\. ticker or company"/);
  assert.match(dashboard, /role="listbox"/);
  assert.doesNotMatch(dashboard, /useState\("GOOGL"\)/);
  assert.match(dashboard, /onPointerMove/);
  assert.match(dashboard, /analyzer-chart-hover-tooltip/);
  assert.match(dashboard, /analyzer-chart-hover-price-tag/);
  assert.match(dashboard, /yAxisLabel=/);
  assert.doesNotMatch(dashboard, /TIINGO_API_KEY|FMP_API_KEY/);
  assert.match(styles, /\.stock-analyzer-shell/);
  assert.match(styles, /\.analyzer-chart/);
  assert.match(styles, /\.analyzer-chart-hover-line/);
  assert.match(styles, /\.analyzer-chart-hover-price-tag/);
  assert.match(styles, /\.analyzer-chart-axis-label/);

  await assert.doesNotReject(readFile(new URL("../app/dashboard/stock-analyzer.ts", import.meta.url), "utf8"));
  assert.ok(projectRoot);
});
