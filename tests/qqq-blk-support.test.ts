import assert from "node:assert/strict";
import test from "node:test";

import { createHoldingEdits } from "../app/dashboard/edit-model";
import { createLiveMarketRefreshPlan } from "../app/dashboard/live-market";
import { handleMarketApiRequest } from "../app/dashboard/market-api";
import { mergePersistedMarketQuotes } from "../app/dashboard/portfolio-repository";
import {
  buildDashboardSnapshotFromSharedPortfolio,
  exportMinimalHoldingsWorkbook,
  parseMinimalHoldingsWorkbook,
  validateSharedHoldings,
  type PortfolioSettings,
} from "../app/dashboard/shared-portfolio";

const settings: PortfolioSettings = {
  schemaVersion: 1,
  asOfDate: "2 Oct 2026",
  defaultFx: 33.254,
  totalRealizedPnl: 0,
  shareholders: [
    {
      owner: "Mom",
      sharedCapital: 1_000_000,
      poolPercent: 1,
      personalCapital: 0,
      totalInvested: 1_000_000,
    },
  ],
  dividend: { whtRate: 0.1, lines: [] },
  historicalDividend: { whtRate: 0.1, lines: [], gross: 0, wht: 0, net: 0 },
  transactions: [],
};

test("imports and values pooled QQQ and BLK in USD", () => {
  const holdings = validateSharedHoldings([
    { ticker: "QQQ", ownerAccount: "Shared", entryPrice: 99_284.08 / 133.5, units: 133.5 },
    { ticker: "BLK", ownerAccount: "Shared", entryPrice: 20_095.58 / 19, units: 19 },
    { ticker: "CASH", ownerAccount: "Shared", entryPrice: 1_000, units: 1 },
  ]);
  const exported = exportMinimalHoldingsWorkbook(holdings);
  assert.deepEqual(parseMinimalHoldingsWorkbook(exported.bytes, exported.filename).holdings, holdings);

  const snapshot = buildDashboardSnapshotFromSharedPortfolio(holdings, settings, "audit.xlsx");
  const qqq = snapshot.holdings.find((holding) => holding.ticker === "QQQ");
  const blk = snapshot.holdings.find((holding) => holding.ticker === "BLK");
  assert.ok(qqq);
  assert.ok(blk);
  assert.equal(qqq.currency, "USD");
  assert.equal(blk.currency, "USD");
  assert.equal(qqq.category, "shared");
  assert.equal(blk.category, "shared");
  assert.ok(Math.abs(qqq.costBasis - 99_284.08 * 33.254) < 0.00001);
  assert.ok(Math.abs(blk.costBasis - 20_095.58 * 33.254) < 0.00001);

  const plan = createLiveMarketRefreshPlan(snapshot, createHoldingEdits(snapshot));
  assert.deepEqual(plan.symbols, ["QQQ", "BLK", "USDTHB"]);
  assert.deepEqual(plan.unmappedTickers, {});
});

test("fetches and persists QQQ from NASDAQ and BLK from NYSE", async () => {
  const calls: string[] = [];
  const response = await handleMarketApiRequest(
    new Request("https://dashboard.local/api/market/refresh"),
    async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/QQQ:NASDAQ")) {
        return new Response('<div title="QQQ:NASDAQ"></div><div data-exchange="NASDAQ" data-currency-code="USD" data-last-price="749.58"><div class="YMlKec fxKbKc">$749.58</div></div>');
      }
      if (url.includes("/BLK:NYSE")) {
        return new Response('<div title="BLK:NYSE"></div><div data-exchange="NYSE" data-currency-code="USD" data-last-price="1086.31"><div class="YMlKec fxKbKc">$1,086.31</div></div>');
      }
      return new Response("unavailable", { status: 503 });
    },
  );
  assert.ok(response);
  const body = await response.json();
  assert.ok(calls.includes("https://www.google.com/finance/quote/QQQ:NASDAQ?hl=en"));
  assert.ok(calls.includes("https://www.google.com/finance/quote/BLK:NYSE?hl=en"));
  assert.equal(body.quotes.QQQ?.price, 749.58);
  assert.equal(body.quotes.BLK?.price, 1086.31);
  const merged = mergePersistedMarketQuotes({}, body);
  assert.deepEqual(merged.refreshedKeys.filter((key) => key === "QQQ" || key === "BLK"), ["QQQ", "BLK"]);
});
