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
  asOfDate: "15 Sep 2026",
  defaultFx: 33.254,
  totalRealizedPnl: 0,
  shareholders: [{ owner: "Mom", sharedCapital: 1870000, poolPercent: 1,
    personalCapital: 0, totalInvested: 1870000 }],
  dividend: { whtRate: 0.1, lines: [] },
  historicalDividend: { whtRate: 0.1, lines: [], gross: 0, wht: 0, net: 0 },
  transactions: [],
};

test("imports and round-trips pooled ASML with USD cost including broker charges", () => {
  let holdings: ReturnType<typeof validateSharedHoldings> = [];
  assert.doesNotThrow(() => {
    holdings = validateSharedHoldings([
      { ticker: "ASML", ownerAccount: "Shared", entryPrice: 9541.72 / 6, units: 6 },
      { ticker: "CASH", ownerAccount: "Shared", entryPrice: 3000, units: 1 },
    ]);
  });
  const exported = exportMinimalHoldingsWorkbook(holdings);
  assert.deepEqual(parseMinimalHoldingsWorkbook(exported.bytes, exported.filename).holdings, holdings);
  const snapshot = buildDashboardSnapshotFromSharedPortfolio(holdings, settings, "audit.xlsx");
  const asml = snapshot.holdings.find((holding) => holding.ticker === "ASML");
  assert.ok(asml);
  assert.equal(asml.currency, "USD");
  assert.equal(asml.category, "shared");
  assert.ok(Math.abs(asml.costBasis - 9541.72 * 33.254) < 0.00001);
  const plan = createLiveMarketRefreshPlan(snapshot, createHoldingEdits(snapshot));
  assert.deepEqual(plan.symbols, ["ASML", "USDTHB"]);
  assert.deepEqual(plan.unmappedTickers, {});
});

test("fetches ASML only from NASDAQ USD and retains it through quote persistence", async () => {
  const calls: string[] = [];
  const response = await handleMarketApiRequest(
    new Request("https://dashboard.local/api/market/refresh"),
    async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/ASML:NASDAQ")) {
        return new Response('<div title="ASML:NASDAQ"></div><div data-exchange="NASDAQ" data-currency-code="USD" data-last-price="1592.46"><div class="YMlKec fxKbKc">$1,592.46</div></div>');
      }
      return new Response("unavailable", { status: 503 });
    },
  );
  assert.ok(response);
  const body = await response.json();
  assert.ok(calls.some((url) => url === "https://www.google.com/finance/quote/ASML:NASDAQ?hl=en"));
  assert.equal(body.quotes.ASML?.price, 1592.46);
  assert.equal(body.quotes.ASML?.currency, "USD");
  assert.equal(body.quotes.ASML?.exchange, "NASDAQ");
  const merged = mergePersistedMarketQuotes({}, body);
  assert.equal(merged.quotes.ASML?.price, 1592.46);
  assert.ok(merged.refreshedKeys.includes("ASML"));
  assert.ok(!merged.refreshedKeys.includes("CASH"));
});
