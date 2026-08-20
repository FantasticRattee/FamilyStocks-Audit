import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  calculateDashboard,
  calculateShareholderEquityRows,
  createScenario,
  deriveSalePnlSummary,
  parseWorkbook,
} from "../app/dashboard/model";

const sourceWorkbook = new URL(
  "../../Portfolio_Accounting.xlsx",
  import.meta.url,
);

const closeTo = (actual: number, expected: number, tolerance = 0.01) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`,
  );
};

const loadSourceSnapshot = async () => {
  const file = await readFile(sourceWorkbook);
  return parseWorkbook(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
    "Portfolio_Accounting.xlsx",
  );
};

test("imports the pooled stock-audit workbook using labels and preserves its key totals", async () => {
  const snapshot = await loadSourceSnapshot();

  assert.equal(snapshot.asOfDate, "20 Aug 2026");
  closeTo(snapshot.summary.totalMarketValue, 3427332.274477695);
  closeTo(snapshot.summary.sharedCapital, 3309606.003945636);
  closeTo(snapshot.summary.sharedMarketValue, 3427332.274477695);
  closeTo(snapshot.summary.totalRealizedPnl, 512769.7674799737);
  assert.deepEqual(snapshot.holdings.map((holding) => holding.ticker), [
    "QQQI",
    "GOOGL",
    "META",
    "AVGO",
    "SPCX",
    "CASH",
  ]);
  assert.deepEqual(
    snapshot.shareholders.map((holder) => holder.owner),
    ["Mom", "Ryu", "Rattee"],
  );
  assert.equal(snapshot.transactions[0].date, "2025-02-06");
  assert.equal(snapshot.transactions.at(-2)?.date, "2026-08-19");
  assert.equal(snapshot.transactions.at(-2)?.side, "BUY");
  assert.equal(snapshot.transactions.at(-2)?.ticker, "SPCX");
  assert.equal(snapshot.transactions.at(-2)?.account, "Shared-US");
  assert.equal(snapshot.transactions.at(-1)?.date, "2026-08-20");
  assert.equal(snapshot.transactions.at(-1)?.ticker, "CASH");
  closeTo(snapshot.shareholders[0].poolPercent, 0.4683336923344125, 0.000001);
  closeTo(
    (snapshot.shareholders[0] as typeof snapshot.shareholders[0] & { cashPercent?: number })
      .cashPercent ?? 0,
    0.4683336923344125,
    0.000001,
  );
  assert.equal(snapshot.holdings.every((holding) => holding.category === "shared"), true);
  closeTo(snapshot.dividend.whtRate, 0.1, 0.000001);
});

test("prices only current pooled holdings without recreating sold positions", async () => {
  const snapshot = await loadSourceSnapshot();
  const scenario = createScenario(snapshot);
  scenario.fx = 33;
  scenario.prices.QQQI = 54;
  scenario.prices.GOOGL = 330;
  scenario.prices.META = 580;
  scenario.prices.AVGO = 390;
  scenario.prices.SPCX = 140;

  const result = calculateDashboard(snapshot, scenario);
  assert.deepEqual(result.holdings.map((holding) => holding.ticker), [
    "QQQI",
    "GOOGL",
    "META",
    "AVGO",
    "SPCX",
    "CASH",
  ]);
  assert.equal(result.holdings.some((holding) => holding.ticker === "NVDA"), false);
  const cash = snapshot.holdings.find((holding) => holding.ticker === "CASH");
  assert.ok(cash);
  closeTo(
    result.holdings.find((holding) => holding.ticker === "CASH")?.marketValue ?? 0,
    cash.costBasis,
  );
  const expectedSharedMarketValue =
    cash.costBasis +
    1190 * 54 * 33 +
    40 * 330 * 33 +
    20 * 580 * 33 +
    6.9162 * 390 * 33 +
    65 * 140 * 33;
  closeTo(result.totals.sharedMarketValue, expectedSharedMarketValue);
  closeTo(result.totals.personalMarketValue, 0);
  closeTo(result.totals.marketValue, expectedSharedMarketValue);
});

test("uses total contributed capital to split a future pooled dividend forecast", async () => {
  const snapshot = await loadSourceSnapshot();
  const scenario = createScenario(snapshot);
  const kbank = snapshot.dividend.lines.find((line) => line.ticker === "KBANK");
  assert.ok(kbank);
  kbank.eligibleQuantity = 630;
  scenario.dividendDps.KBANK = 13;

  const result = calculateDashboard(snapshot, scenario);
  const mom = result.dividend.byOwner.find((owner) => owner.owner === "Mom");

  closeTo(result.dividend.gross, 8190);
  closeTo(result.dividend.wht, 819);
  closeTo(result.dividend.net, 7371);
  assert.ok(mom);
  closeTo(mom.net, 7371 * (1550000 / 3309606.003945636));
});

test("allocates every active pooled asset by total contributed-capital percentage", async () => {
  const snapshot = await loadSourceSnapshot();
  const result = calculateDashboard(snapshot, createScenario(snapshot));
  const owners = calculateShareholderEquityRows(snapshot, result);
  const cashValue = result.holdings.find((holding) => holding.ticker === "CASH")?.marketValue ?? 0;
  const investmentValue = result.totals.marketValue - cashValue;

  for (const owner of owners) {
    closeTo(owner.cashMarketValue, cashValue * owner.poolPercent);
    closeTo(owner.sharedInvestmentMarketValue, investmentValue * owner.poolPercent);
    closeTo(
      owner.sharedMarketValue,
      owner.cashMarketValue + owner.sharedInvestmentMarketValue,
    );
    closeTo(owner.personalMarketValue, 0);
    closeTo(owner.estimatedEquity, result.totals.marketValue * owner.poolPercent);
  }
  closeTo(
    owners.reduce((total, owner) => total + owner.estimatedEquity, 0),
    result.totals.marketValue,
  );
});

test("derives dated realized sale P&L without applying the pooled split to historical sales", async () => {
  const snapshot = await loadSourceSnapshot();
  const salePnl = deriveSalePnlSummary(snapshot.transactions, snapshot.shareholders);
  const ledgerSales = snapshot.transactions.filter(
    (transaction) => transaction.side === "SELL",
  );
  const rattee = snapshot.shareholders.find((holder) => holder.owner === "Rattee");

  assert.ok(rattee);
  assert.equal(salePnl.rows.length, ledgerSales.length);
  assert.equal(
    salePnl.rows.every((row, index, rows) =>
      index === 0 || rows[index - 1].date >= row.date,
    ),
    true,
  );
  for (const row of salePnl.rows) {
    closeTo(row.soldCostThb, row.netProceedsThb - row.realizedPnlThb);
  }

  const historicalSale = salePnl.rows.find((row) => row.date < "2026-08-05");
  const pooledSale = salePnl.rows.find((row) => row.date >= "2026-08-05");
  assert.ok(historicalSale);
  assert.ok(pooledSale);
  assert.equal(historicalSale.allocationMode, "historical");
  assert.equal(historicalSale.ratteeShareThb, null);
  assert.equal(pooledSale.allocationMode, "pooled");
  closeTo(
    pooledSale.ratteeShareThb ?? 0,
    pooledSale.realizedPnlThb * rattee.poolPercent,
  );
  closeTo(
    salePnl.totalGainsThb + salePnl.totalLossesThb,
    salePnl.netRealizedPnlThb,
  );
  closeTo(
    salePnl.netRealizedPnlThb,
    ledgerSales.reduce((total, transaction) => total + transaction.realizedPnlThb, 0),
  );
});

test("rejects a file that cannot be read as the required audit workbook", () => {
  assert.throws(
    () => parseWorkbook(new Uint8Array([1, 2, 3, 4]).buffer, "bad.xlsx"),
    /workbook|xlsx|sheet/i,
  );
});
