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

  assert.equal(snapshot.asOfDate, "7 Aug 2026");
  closeTo(snapshot.summary.totalMarketValue, 3082130.2945);
  closeTo(snapshot.summary.sharedCapital, 2949606.003945636);
  closeTo(snapshot.summary.sharedMarketValue, 3082130.2945);
  closeTo(snapshot.summary.totalRealizedPnl, 512874.3623946404);
  assert.deepEqual(snapshot.holdings.map((holding) => holding.ticker), ["CASH"]);
  assert.deepEqual(
    snapshot.shareholders.map((holder) => holder.owner),
    ["Mom", "Ryu", "Rattee"],
  );
  assert.equal(snapshot.transactions[0].date, "2025-02-06");
  assert.equal(snapshot.transactions.at(-1)?.date, "2026-08-07");
  assert.equal(snapshot.transactions.at(-1)?.side, "SELL");
  assert.equal(snapshot.transactions.at(-1)?.ticker, "GOOGL");
  assert.equal(snapshot.transactions.at(-1)?.account, "Shared-US");
  closeTo(snapshot.shareholders[0].poolPercent, 0.42378541348502036, 0.000001);
  closeTo(
    (snapshot.shareholders[0] as typeof snapshot.shareholders[0] & { cashPercent?: number })
      .cashPercent ?? 0,
    0.42378541348502036,
    0.000001,
  );
  assert.equal(snapshot.holdings.every((holding) => holding.category === "shared"), true);
  closeTo(snapshot.dividend.whtRate, 0.1, 0.000001);
});

test("does not recreate sold pooled holdings in a price scenario", async () => {
  const snapshot = await loadSourceSnapshot();
  const scenario = createScenario(snapshot);
  scenario.fx = 33;
  scenario.prices.GOOGL = 330;
  scenario.prices.NVDA = 200;

  const result = calculateDashboard(snapshot, scenario);
  assert.deepEqual(result.holdings.map((holding) => holding.ticker), ["CASH"]);
  const cashValue = snapshot.holdings[0]?.costBasis ?? 0;
  closeTo(result.holdings[0]?.marketValue ?? 0, cashValue);
  closeTo(result.totals.sharedMarketValue, cashValue);
  closeTo(result.totals.personalMarketValue, 0);
  closeTo(result.totals.marketValue, cashValue);
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
  closeTo(mom.net, 7371 * (1250000 / 2949606.003945636));
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
