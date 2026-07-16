import assert from "node:assert/strict";
import test from "node:test";

import {
  handlePortfolioApiRequest,
  type PortfolioRepository,
  type SharedPortfolioState,
} from "../app/dashboard/portfolio-api";
import {
  mergePersistedMarketQuotes,
  type MarketQuoteSnapshot,
} from "../app/dashboard/portfolio-repository";
import { PostgresPortfolioRepository } from "../app/dashboard/postgres-portfolio-repository";
import type {
  PortfolioSettings,
  SharedHoldingInput,
} from "../app/dashboard/shared-portfolio";

const seedHolding: SharedHoldingInput = {
  ticker: "SCB",
  ownerAccount: "Shared",
  entryPrice: 136.1,
  units: 14_999,
};

const settings: PortfolioSettings = {
  schemaVersion: 1,
  asOfDate: "16 Jul 2026",
  defaultFx: 33.3383,
  totalRealizedPnl: 0,
  shareholders: [],
  dividend: { whtRate: 0.1, lines: [] },
  historicalDividend: { lines: [], gross: 0, wht: 0, net: 0 },
  transactions: [],
};

const state = (holdings: SharedHoldingInput[] = [seedHolding]): SharedPortfolioState => ({
  holdings,
  settings,
  quotes: {},
  latestImport: null,
});

class FakeRepository implements PortfolioRepository {
  current: SharedPortfolioState | null = null;
  seedCalls = 0;
  replaceCalls = 0;

  async loadOrSeed(seed: SharedPortfolioState) {
    this.seedCalls += 1;
    this.current ??= structuredClone(seed);
    return structuredClone(this.current);
  }

  async replaceHoldings(
    holdings: SharedHoldingInput[],
    metadata: { filename: string; importedAt: string; contentHash: string },
  ) {
    this.replaceCalls += 1;
    assert.ok(this.current);
    this.current = {
      ...this.current,
      holdings: structuredClone(holdings),
      latestImport: {
        ...metadata,
        rowCount: holdings.length,
      },
    };
    return structuredClone(this.current);
  }
}

test("GET /api/portfolio atomically loads or seeds shared state", async () => {
  const repository = new FakeRepository();
  const response = await handlePortfolioApiRequest(
    new Request("https://dashboard.local/api/portfolio"),
    { EDIT_MODE_PASSWORD: "test-edit-password" },
    repository,
    state(),
  );

  assert.ok(response);
  assert.equal(response.status, 200);
  assert.equal(repository.seedCalls, 1);
  const body = (await response.json()) as SharedPortfolioState;
  assert.deepEqual(body.holdings, [seedHolding]);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("POST /api/portfolio/import rejects a wrong password without replacing holdings", async () => {
  const repository = new FakeRepository();
  repository.current = state();
  const response = await handlePortfolioApiRequest(
    new Request("https://dashboard.local/api/portfolio/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        password: "wrong",
        filename: "new.xlsx",
        holdings: [
          { ticker: "KBANK", ownerAccount: "Shared", entryPrice: 181.8, units: 630 },
        ],
      }),
    }),
    { EDIT_MODE_PASSWORD: "test-edit-password" },
    repository,
    state(),
  );

  assert.ok(response);
  assert.equal(response.status, 401);
  assert.equal(repository.replaceCalls, 0);
  assert.deepEqual(repository.current?.holdings, [seedHolding]);
});

test("POST /api/portfolio/import validates and transactionally replaces shared holdings", async () => {
  const repository = new FakeRepository();
  repository.current = state();
  const replacement = [
    { ticker: "KBANK", ownerAccount: "Shared", entryPrice: 181.8, units: 630 },
  ];
  const response = await handlePortfolioApiRequest(
    new Request("https://dashboard.local/api/portfolio/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        password: "test-edit-password",
        filename: "new.xlsx",
        holdings: replacement,
      }),
    }),
    { EDIT_MODE_PASSWORD: "test-edit-password" },
    repository,
    state(),
  );

  assert.ok(response);
  assert.equal(response.status, 200);
  assert.equal(repository.replaceCalls, 1);
  const body = (await response.json()) as SharedPortfolioState;
  assert.deepEqual(body.holdings, replacement);
  assert.equal(body.latestImport?.filename, "new.xlsx");
  assert.equal(body.latestImport?.rowCount, 1);
  assert.match(body.latestImport?.contentHash ?? "", /^[a-f0-9]{64}$/);
});

test("partial refresh updates successes and explicitly retains prior database quotes", () => {
  const oldQuote = (symbol: string, price: number, currency: string): MarketQuoteSnapshot => ({
    symbol,
    price,
    currency,
    exchange: "Test",
    marketState: "CLOSED",
    quoteTimestamp: "2026-07-15T09:00:00.000Z",
    source: "OpenAI web search",
  });
  const stored = {
    GOOGL: oldQuote("GOOGL", 370, "USD"),
    SCB: oldQuote("SCB", 156, "THB"),
    KBANK: oldQuote("KBANK", 231, "THB"),
    USDTHB: oldQuote("USDTHB", 33.3, "THB"),
  };
  const nextGoogl = oldQuote("GOOGL", 372.49, "USD");

  const merged = mergePersistedMarketQuotes(stored, {
    quotes: { GOOGL: nextGoogl },
    failures: {
      SCB: "No new quote",
      KBANK: "No new quote",
      USDTHB: "No new quote",
    },
  });

  assert.equal(merged.quotes.GOOGL.price, 372.49);
  assert.equal(merged.quotes.SCB.price, 156);
  assert.equal(merged.quotes.KBANK.price, 231);
  assert.equal(merged.quotes.USDTHB.price, 33.3);
  assert.deepEqual(merged.refreshedKeys, ["GOOGL"]);
  assert.deepEqual(merged.retainedKeys, ["SCB", "KBANK", "USDTHB"]);
  assert.deepEqual(merged.failures, {});
});

test("retries PostgreSQL schema setup after a transient first failure", async () => {
  let schemaAttempts = 0;
  const fakeClient = {
    async query(sql: string) {
      if (
        sql === "BEGIN" ||
        sql === "COMMIT" ||
        sql === "ROLLBACK" ||
        sql.includes("pg_advisory_xact_lock")
      ) {
        return { rows: [] };
      }
      if (sql.includes("SELECT EXISTS")) {
        return { rows: [{ exists: true }] };
      }
      if (sql.includes("SELECT payload FROM portfolio_settings")) {
        return { rows: [{ payload: settings }] };
      }
      if (sql.includes("FROM portfolio_holdings")) {
        return {
          rows: [
            {
              ticker: seedHolding.ticker,
              owner_account: seedHolding.ownerAccount,
              entry_price: seedHolding.entryPrice,
              units: seedHolding.units,
            },
          ],
        };
      }
      if (sql.includes("FROM market_quotes") || sql.includes("FROM portfolio_imports")) {
        return { rows: [] };
      }
      throw new Error(`Unexpected test query: ${sql}`);
    },
    release() {},
  };
  const fakePool = {
    async query() {
      schemaAttempts += 1;
      if (schemaAttempts === 1) throw new Error("transient schema failure");
      return { rows: [] };
    },
    async connect() {
      return fakeClient;
    },
  };
  const repository = new PostgresPortfolioRepository(fakePool as never);

  await assert.rejects(
    repository.loadOrSeed(state()),
    /transient schema failure/,
  );
  const loaded = await repository.loadOrSeed(state());

  assert.equal(schemaAttempts, 2);
  assert.deepEqual(loaded.holdings, [seedHolding]);
});

test("PostgreSQL cooldown returns fresh persisted quotes and expires stale ones", async () => {
  const createRepository = (quoteTimestamp: string) => {
    const fakePool = {
      async query(sql: string) {
        if (sql.includes("CREATE TABLE IF NOT EXISTS")) return { rows: [] };
        if (sql.includes("FROM market_quotes")) {
          return {
            rows: [
              {
                market_key: "GOOGL",
                symbol: "GOOGL",
                price: 372.49,
                currency: "USD",
                exchange: "NASDAQ",
                market_state: "SEARCHED",
                quote_timestamp: quoteTimestamp,
                source: "OpenAI web search",
                freshness: "searched live",
                sources: [
                  {
                    url: "https://www.google.com/finance/quote/GOOGL:NASDAQ",
                    title: "Alphabet Inc Class A",
                  },
                ],
              },
            ],
          };
        }
        throw new Error(`Unexpected test query: ${sql}`);
      },
    };
    return new PostgresPortfolioRepository(fakePool as never);
  };

  const freshRepository = createRepository(
    new Date(Date.now() - 60_000).toISOString(),
  );
  const fresh = await freshRepository.loadRecentMarketRefresh(5 * 60 * 1000);
  assert.ok(fresh);
  assert.equal(fresh.quotes.GOOGL?.price, 372.49);
  assert.deepEqual(fresh.refreshedKeys, []);
  assert.deepEqual(fresh.retainedKeys, ["GOOGL"]);
  assert.equal(fresh.provider, "OpenAI web search");
  assert.equal(fresh.sources?.length, 1);

  const staleRepository = createRepository(
    new Date(Date.now() - 6 * 60_000).toISOString(),
  );
  assert.equal(
    await staleRepository.loadRecentMarketRefresh(5 * 60 * 1000),
    null,
  );
});
