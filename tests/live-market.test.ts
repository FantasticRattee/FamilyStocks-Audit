import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createHoldingEdits, type HoldingEdits } from "../app/dashboard/edit-model";
import type { MarketQuote } from "../app/dashboard/market-data";
import {
  calculateDashboard,
  createScenario,
  parseWorkbook,
  type DashboardSnapshot,
  type Scenario,
} from "../app/dashboard/model";

const sourceWorkbook = new URL(
  "../../Portfolio_Accounting.xlsx",
  import.meta.url,
);

type BatchQuotes = {
  quotes: Record<string, MarketQuote>;
  failures: Record<string, string>;
  fetchedAt: string;
  provider?: string;
  sources?: Array<{ url: string; title: string }>;
  refreshedKeys?: string[];
  retainedKeys?: string[];
  cooldownActive?: boolean;
};

type LiveMarketModule = {
  createLiveMarketRefreshPlan: (
    snapshot: DashboardSnapshot,
    edits: HoldingEdits,
  ) => {
    symbols: string[];
    stocks: Array<{ ticker: string; marketKey: string; currency: "THB" | "USD" }>;
    unmappedTickers: Record<string, string>;
  };
  createLiveMarketState: (
    plan: ReturnType<LiveMarketModule["createLiveMarketRefreshPlan"]>,
    response: BatchQuotes,
  ) => unknown;
  applyLiveMarketState: (
    snapshot: DashboardSnapshot,
    auditScenario: Scenario,
    state: unknown,
  ) => Scenario;
};

const loadLiveMarketModule = async (): Promise<LiveMarketModule> => {
  const modulePath = "../app/dashboard/live-market";
  const liveMarket = await import(modulePath).catch(() => null);
  assert.ok(liveMarket, "Expected a dedicated live-market module");
  return liveMarket as LiveMarketModule;
};

const loadSnapshot = async () => {
  const file = await readFile(sourceWorkbook);
  return parseWorkbook(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
    "Portfolio_Accounting.xlsx",
  );
};

const quote = (
  symbol: string,
  price: number,
  currency: string,
): MarketQuote => ({
  symbol,
  price,
  currency,
  exchange: "Test exchange",
  marketState: "REGULAR",
  quoteTimestamp: "2026-07-15T16:00:00.000Z",
});

test("maps every active audited holding and USD/THB to provider-neutral refresh keys", async () => {
  const liveMarket = await loadLiveMarketModule();
  const snapshot = await loadSnapshot();
  const plan = liveMarket.createLiveMarketRefreshPlan(
    snapshot,
    createHoldingEdits(snapshot),
  );

  assert.deepEqual(plan.symbols, ["GOOGL", "SCB", "KBANK", "USDTHB"]);
  assert.deepEqual(plan.stocks, [
    { ticker: "GOOGL", marketKey: "GOOGL", currency: "USD" },
    { ticker: "SCB", marketKey: "SCB", currency: "THB" },
    { ticker: "KBANK", marketKey: "KBANK", currency: "THB" },
  ]);
  assert.deepEqual(plan.unmappedTickers, {});
});

test("applies valid live quotes only to the display scenario and refreshes USD/THB", async () => {
  const liveMarket = await loadLiveMarketModule();
  const snapshot = await loadSnapshot();
  const auditScenario = createScenario(snapshot);
  auditScenario.prices.GOOGL = 350;
  auditScenario.fx = 33;
  const plan = liveMarket.createLiveMarketRefreshPlan(
    snapshot,
    createHoldingEdits(snapshot),
  );
  const liveState = liveMarket.createLiveMarketState(plan, {
    quotes: {
      GOOGL: quote("GOOGL", 400, "USD"),
      SCB: quote("SCB.BK", 150, "THB"),
      KBANK: quote("KBANK.BK", 200, "THB"),
      USDTHB: quote("USDTHB", 34, "THB"),
    },
    failures: {},
    fetchedAt: "2026-07-15T16:01:00.000Z",
  });

  const liveScenario = liveMarket.applyLiveMarketState(
    snapshot,
    auditScenario,
    liveState,
  );

  assert.equal(liveScenario.prices.GOOGL, 400);
  assert.equal(liveScenario.prices.SCB, 150);
  assert.equal(liveScenario.prices.KBANK, 200);
  assert.equal(liveScenario.fx, 34);
  assert.equal(auditScenario.prices.GOOGL, 350);
  assert.equal(auditScenario.fx, 33);

  const result = calculateDashboard(snapshot, liveScenario);
  assert.equal(result.totals.personalMarketValue, 64 * 400 * 34);
  assert.equal(result.totals.sharedMarketValue, 14_999 * 150 + 630 * 200);
});

test("retains OpenAI web-search source links with the display-only market state", async () => {
  const liveMarket = await loadLiveMarketModule();
  const snapshot = await loadSnapshot();
  const plan = liveMarket.createLiveMarketRefreshPlan(
    snapshot,
    createHoldingEdits(snapshot),
  );

  const state = liveMarket.createLiveMarketState(plan, {
    quotes: {
      GOOGL: {
        ...quote("GOOGL", 372.49, "USD"),
        source: "OpenAI web search",
        freshness: "searched live",
      },
      SCB: quote("SCB", 122.5, "THB"),
      KBANK: quote("KBANK", 175.5, "THB"),
      USDTHB: quote("USDTHB", 33.8, "THB"),
    },
    failures: {},
    fetchedAt: "2026-07-15T16:00:00.000Z",
    provider: "OpenAI web search",
    sources: [
      {
        url: "https://www.google.com/finance/quote/GOOGL:NASDAQ",
        title: "Alphabet Inc Class A",
      },
    ],
  }) as {
    provider?: string;
    sources?: Array<{ url: string; title: string }>;
  };

  assert.equal(state.provider, "OpenAI web search");
  assert.deepEqual(state.sources, [
    {
      url: "https://www.google.com/finance/quote/GOOGL:NASDAQ",
      title: "Alphabet Inc Class A",
    },
  ]);
});

test("marks a persisted five-minute cooldown response for transparent UI status", async () => {
  const liveMarket = await loadLiveMarketModule();
  const snapshot = await loadSnapshot();
  const plan = liveMarket.createLiveMarketRefreshPlan(
    snapshot,
    createHoldingEdits(snapshot),
  );

  const state = liveMarket.createLiveMarketState(plan, {
    quotes: {
      GOOGL: quote("GOOGL", 372.49, "USD"),
      SCB: quote("SCB", 122.5, "THB"),
      KBANK: quote("KBANK", 175.5, "THB"),
      USDTHB: quote("USDTHB", 33.8, "THB"),
    },
    failures: {},
    fetchedAt: "2026-07-15T16:00:00.000Z",
    provider: "OpenAI web search",
    refreshedKeys: [],
    retainedKeys: ["GOOGL", "SCB", "KBANK", "USDTHB"],
    cooldownActive: true,
  }) as { cooldownActive?: boolean };

  assert.equal(state.cooldownActive, true);
});

test("keeps the audit price and FX for failed or currency-mismatched quotes", async () => {
  const liveMarket = await loadLiveMarketModule();
  const snapshot = await loadSnapshot();
  const auditScenario = createScenario(snapshot);
  auditScenario.prices.GOOGL = 350;
  auditScenario.fx = 33;
  const plan = liveMarket.createLiveMarketRefreshPlan(
    snapshot,
    createHoldingEdits(snapshot),
  );
  const liveState = liveMarket.createLiveMarketState(plan, {
    quotes: {
      GOOGL: quote("GOOGL", 400, "THB"),
      USDTHB: quote("USDTHB", -1, "THB"),
    },
    failures: {
      SCB: "OpenAI web search is temporarily unavailable.",
      KBANK: "OpenAI web search is temporarily unavailable.",
    },
    fetchedAt: "2026-07-15T16:01:00.000Z",
  });

  const liveScenario = liveMarket.applyLiveMarketState(
    snapshot,
    auditScenario,
    liveState,
  );

  assert.equal(liveScenario.prices.GOOGL, 350);
  assert.equal(liveScenario.fx, 33);
  assert.equal(liveScenario.prices.SCB, auditScenario.prices.SCB);
  assert.equal(liveScenario.prices.KBANK, auditScenario.prices.KBANK);
});
