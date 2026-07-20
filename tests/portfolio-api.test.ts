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
  historicalDividend: { whtRate: 0.1, lines: [], gross: 0, wht: 0, net: 0 },
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
    settingsOverride?: PortfolioSettings,
  ) {
    this.replaceCalls += 1;
    assert.ok(this.current);
    this.current = {
      ...this.current,
      holdings: structuredClone(holdings),
      settings: settingsOverride ? structuredClone(settingsOverride) : this.current.settings,
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

test("POST canonical audit import atomically replaces holdings and audit settings", async () => {
  const repository = new FakeRepository();
  repository.current = state();
  const auditSettings: PortfolioSettings = {
    ...settings,
    asOfDate: "18 Jul 2026",
    totalRealizedPnl: 33_871.68157610536,
    shareholders: [
      {
        owner: "Rattee",
        sharedCapital: 605_932.19,
        poolPercent: 0.2811,
        personalCapital: 371_991.4516283695,
        totalInvested: 977_923.6416283695,
      },
    ],
    transactions: [
      {
        date: "2026-07-18",
        account: "Personal-US (Me)",
        ticker: "GOOGL",
        side: "BUY",
        order: "Limit",
        quantity: 10,
        priceNative: 343,
        currency: "USD",
        grossNative: 3435.34,
        fx: 33.76667229444538,
        costProceedsThb: -116_000,
        realizedPnlThb: 0,
        note: "Canonical audit import test",
      },
    ],
  };
  const replacement = [
    { ticker: "GOOGL", ownerAccount: "Rattee", entryPrice: 355.42, units: 31 },
  ];
  const response = await handlePortfolioApiRequest(
    new Request("https://dashboard.local/api/portfolio/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        password: "test-edit-password",
        filename: "Portfolio_Accounting.xlsx",
        holdings: replacement,
        settings: auditSettings,
      }),
    }),
    { EDIT_MODE_PASSWORD: "test-edit-password" },
    repository,
    state(),
  );

  assert.ok(response);
  assert.equal(response.status, 200);
  const body = (await response.json()) as SharedPortfolioState;
  assert.deepEqual(body.holdings, replacement);
  assert.equal(body.settings.asOfDate, "18 Jul 2026");
  assert.equal(body.settings.shareholders[0]?.totalInvested, 977_923.6416283695);
  assert.equal(body.settings.transactions.at(-1)?.quantity, 10);
});

test("POST canonical audit import rejects malformed settings without changing shared state", async () => {
  const repository = new FakeRepository();
  repository.current = state();
  const response = await handlePortfolioApiRequest(
    new Request("https://dashboard.local/api/portfolio/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        password: "test-edit-password",
        filename: "Portfolio_Accounting.xlsx",
        holdings: [seedHolding],
        settings: { ...settings, defaultFx: 0 },
      }),
    }),
    { EDIT_MODE_PASSWORD: "test-edit-password" },
    repository,
    state(),
  );

  assert.ok(response);
  assert.equal(response.status, 400);
  assert.equal(repository.replaceCalls, 0);
  assert.equal(repository.current?.settings.asOfDate, "16 Jul 2026");
});

test("partial refresh updates successes and explicitly retains prior database quotes", () => {
  const oldQuote = (symbol: string, price: number, currency: string): MarketQuoteSnapshot => ({
    symbol,
    price,
    currency,
    exchange: "Test",
    marketState: "CLOSED",
    quoteTimestamp: "2026-07-15T09:00:00.000Z",
    source: "Google Finance",
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
