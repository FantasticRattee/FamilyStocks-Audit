import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createHoldingEdits } from "../app/dashboard/edit-model";
import { createLiveMarketRefreshPlan } from "../app/dashboard/live-market";
import { handleMarketApiRequest } from "../app/dashboard/market-api";
import { mergePersistedMarketQuotes, SHARED_MARKET_KEYS } from "../app/dashboard/portfolio-repository";
import {
  buildDashboardSnapshotFromSharedPortfolio,
  exportMinimalHoldingsWorkbook,
  parseMinimalHoldingsWorkbook,
  validateSharedHoldings,
  type PortfolioSettings,
} from "../app/dashboard/shared-portfolio";

const settings: PortfolioSettings = {
  schemaVersion: 1, asOfDate: "14 Oct 2026", defaultFx: 33.254, totalRealizedPnl: 0,
  shareholders: [{ owner: "Mom", sharedCapital: 1, poolPercent: 1, personalCapital: 0, totalInvested: 1 }],
  dividend: { whtRate: 0.1, lines: [] },
  historicalDividend: { whtRate: 0.1, lines: [], gross: 0, wht: 0, net: 0 },
  transactions: [],
};

test("imports and round-trips shared ORCL as a USD holding with a live quote map", () => {
  const holdings = validateSharedHoldings([
    { ticker: "ORCL", ownerAccount: "Shared", entryPrice: 250, units: 110 },
  ]);
  const exported = exportMinimalHoldingsWorkbook(holdings);
  assert.deepEqual(parseMinimalHoldingsWorkbook(exported.bytes, exported.filename).holdings, holdings);
  const snapshot = buildDashboardSnapshotFromSharedPortfolio(holdings, settings, "audit.xlsx");
  assert.equal(snapshot.holdings.find((holding) => holding.ticker === "ORCL")?.currency, "USD");
  const plan = createLiveMarketRefreshPlan(snapshot, createHoldingEdits(snapshot));
  assert.deepEqual(plan.stocks, [{ ticker: "ORCL", marketKey: "ORCL", currency: "USD" }]);
  assert.deepEqual(plan.symbols, ["ORCL", "USDTHB"]);
});

test("fetches ORCL from Google Finance NYSE/USD and includes the key in quote persistence", async () => {
  const calls: string[] = [];
  const response = await handleMarketApiRequest(
    new Request("https://dashboard.local/api/market/refresh"),
    async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/ORCL:NYSE")) {
        return new Response('<div title="ORCL:NYSE"></div><div data-exchange="NYSE" data-currency-code="USD" data-last-price="143.20"><div class="YMlKec fxKbKc">$143.20</div></div>');
      }
      return new Response("unavailable", { status: 503 });
    },
  );
  assert.ok(response);
  const body = await response.json();
  assert.ok(calls.includes("https://www.google.com/finance/quote/ORCL:NYSE?hl=en"));
  assert.equal(body.quotes.ORCL?.price, 143.2);
  assert.equal(body.quotes.ORCL?.currency, "USD");
  assert.equal(body.quotes.ORCL?.exchange, "NYSE");
  assert.ok(SHARED_MARKET_KEYS.includes("ORCL" as never));
  const merged = mergePersistedMarketQuotes({}, body);
  assert.equal(merged.quotes.ORCL?.price, 143.2);
  assert.ok(merged.refreshedKeys.includes("ORCL"));
});

test("offers positive fee reversals as a distinct ledger side filter", async () => {
  const dashboard = await readFile(new URL("../app/dashboard/Dashboard.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /<option value="FEE_REFUND">FEE REFUND<\/option>/);
  assert.match(dashboard, /transaction\.side === sideFilter/);
});
