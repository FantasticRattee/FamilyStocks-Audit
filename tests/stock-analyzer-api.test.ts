import assert from "node:assert/strict";
import test from "node:test";

import {
  handleStockAnalyzerApiRequest,
  type StockAnalyzerRepository,
  type StockAnalyzerSnapshot,
} from "../app/dashboard/stock-analyzer-api";

const cachedSnapshot: StockAnalyzerSnapshot = {
  ticker: "GOOGL",
  currency: "USD",
  fetchedAt: "2026-07-20T00:00:00.000Z",
  source: {
    price: "Tiingo EOD",
    trailingPe: "Tiingo Fundamentals",
    forwardPe: "Unavailable",
  },
  input: {
    ticker: "GOOGL",
    currency: "USD",
    fetchedAt: "2026-07-20T00:00:00.000Z",
    prices: [{ date: "2026-07-20", close: 200, adjustedClose: 200 }],
    trailingPe: [],
  },
};

class FakeAnalyzerRepository implements StockAnalyzerRepository {
  snapshot: StockAnalyzerSnapshot = structuredClone(cachedSnapshot);
  writes = 0;

  async loadStockAnalyzerSnapshot(ticker: string) {
    return ticker === this.snapshot.ticker ? structuredClone(this.snapshot) : null;
  }

  async saveStockAnalyzerSnapshot(snapshot: StockAnalyzerSnapshot) {
    this.writes += 1;
    this.snapshot = structuredClone(snapshot);
    return structuredClone(snapshot);
  }
}

test("returns a persisted Analyzer snapshot without calling a provider", async () => {
  const repository = new FakeAnalyzerRepository();
  const response = await handleStockAnalyzerApiRequest(
    new Request("https://dashboard.local/api/analyzer?symbol=GOOGL"),
    {},
    repository,
  );

  assert.ok(response);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), cachedSnapshot);
});

test("refuses a live refresh when the Tiingo secret is absent", async () => {
  const repository = new FakeAnalyzerRepository();
  const response = await handleStockAnalyzerApiRequest(
    new Request("https://dashboard.local/api/analyzer/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ symbol: "GOOGL" }),
    }),
    {},
    repository,
  );

  assert.ok(response);
  assert.equal(response.status, 503);
  assert.match((await response.json() as { error: string }).error, /TIINGO_API_KEY/);
  assert.equal(repository.writes, 0);
});

test("persists a successful analyzer refresh and retains the old snapshot after provider failure", async () => {
  const repository = new FakeAnalyzerRepository();
  const refreshed = await handleStockAnalyzerApiRequest(
    new Request("https://dashboard.local/api/analyzer/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ symbol: "MSFT" }),
    }),
    { TIINGO_API_KEY: "test-key" },
    repository,
    async (input) => {
      const url = String(input);
      if (url.includes("/prices")) {
        return Response.json([
          { date: "2025-07-01", close: 400, adjClose: 400 },
          { date: "2026-07-01", close: 440, adjClose: 440 },
        ]);
      }
      return Response.json([{ date: "2026-07-01", peRatio: 30 }]);
    },
  );

  assert.ok(refreshed);
  assert.equal(refreshed.status, 200);
  const body = await refreshed.json() as StockAnalyzerSnapshot;
  assert.equal(body.ticker, "MSFT");
  assert.equal(body.analysis?.currentPrice, 440);
  assert.equal(repository.writes, 1);

  const retained = structuredClone(repository.snapshot);
  const failed = await handleStockAnalyzerApiRequest(
    new Request("https://dashboard.local/api/analyzer/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ symbol: "MSFT" }),
    }),
    { TIINGO_API_KEY: "test-key" },
    repository,
    async () => new Response("source unavailable", { status: 503 }),
  );

  assert.ok(failed);
  assert.equal(failed.status, 502);
  assert.equal(repository.writes, 1);
  assert.deepEqual(repository.snapshot, retained);
});
