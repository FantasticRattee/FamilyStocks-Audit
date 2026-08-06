import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  calculateDashboard,
  calculateShareholderEquityRows,
  createScenario,
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

  assert.equal(snapshot.asOfDate, "5 Aug 2026");
  closeTo(snapshot.summary.totalMarketValue, 2993856.88642);
  closeTo(snapshot.summary.sharedCapital, 2949606.003945636);
  closeTo(snapshot.summary.sharedMarketValue, 2993856.88642);
  closeTo(snapshot.summary.totalRealizedPnl, 499775.2074162766);
  assert.deepEqual(
    snapshot.holdings.map((holding) => holding.ticker).sort(),
    ["CASH", "GOOGL", "NVDA"],
  );
  assert.deepEqual(
    snapshot.shareholders.map((holder) => holder.owner),
    ["Mom", "Ryu", "Rattee"],
  );
  assert.equal(snapshot.transactions[0].date, "2025-02-06");
  assert.equal(snapshot.transactions.at(-1)?.date, "2026-08-05");
  assert.equal(snapshot.transactions.at(-1)?.side, "SELL");
  assert.equal(snapshot.transactions.at(-1)?.ticker, "AMD");
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

test("recalculates a pooled US-price scenario without creating personal holdings", async () => {
  const snapshot = await loadSourceSnapshot();
  const scenario = createScenario(snapshot);
  scenario.fx = 33;
  scenario.prices.GOOGL = 330;
  scenario.prices.NVDA = 200;

  const result = calculateDashboard(snapshot, scenario);
  const googleHoldings = result.holdings.filter((holding) => holding.ticker === "GOOGL");
  const nvdaHoldings = result.holdings.filter((holding) => holding.ticker === "NVDA");
  assert.equal(googleHoldings.length, 1);
  assert.equal(nvdaHoldings.length, 1);
  const expectedGooglValue = 75 * 330 * 33;
  const expectedNvdaValue = 45 * 200 * 33;
  const cashValue = snapshot.holdings.find((holding) => holding.ticker === "CASH")?.costBasis ?? 0;
  closeTo(
    googleHoldings.reduce((total, holding) => total + holding.marketValue, 0),
    expectedGooglValue,
  );
  closeTo(
    nvdaHoldings.reduce((total, holding) => total + holding.marketValue, 0),
    expectedNvdaValue,
  );
  closeTo(result.totals.sharedMarketValue, expectedGooglValue + expectedNvdaValue + cashValue);
  closeTo(result.totals.personalMarketValue, 0);
  closeTo(result.totals.marketValue, expectedGooglValue + expectedNvdaValue + cashValue);
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

test("rejects a file that cannot be read as the required audit workbook", () => {
  assert.throws(
    () => parseWorkbook(new Uint8Array([1, 2, 3, 4]).buffer, "bad.xlsx"),
    /workbook|xlsx|sheet/i,
  );
});
