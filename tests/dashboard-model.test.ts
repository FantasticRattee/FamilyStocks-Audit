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

test("imports the stock-audit workbook using labels and preserves its key totals", async () => {
  const snapshot = await loadSourceSnapshot();

  assert.equal(snapshot.asOfDate, "4 Aug 2026");
  closeTo(snapshot.summary.totalMarketValue, 2904935.44704);
  closeTo(snapshot.summary.sharedCapital, 2155932.19);
  closeTo(snapshot.summary.sharedMarketValue, 248270.5);
  closeTo(snapshot.summary.totalRealizedPnl, 366781.8851022768);
  assert.deepEqual(
    snapshot.holdings.map((holding) => holding.ticker).sort(),
    [
      "AAPL",
      "AAPL",
      "CASH",
      "GOOGL",
      "GOOGL",
      "KBANK",
      "META",
      "META",
      "MU",
      "MU",
      "NVDA",
      "NVDA",
    ],
  );
  assert.deepEqual(
    snapshot.shareholders.map((holder) => holder.owner),
    ["Mom", "Ryu", "Rattee"],
  );
  assert.equal(snapshot.transactions[0].date, "2025-02-06");
  assert.equal(snapshot.transactions.at(-1)?.date, "2026-08-04");
  assert.equal(snapshot.transactions.at(-1)?.side, "TRANSFER");
  closeTo(snapshot.shareholders[0].poolPercent, 0.5797956010852086, 0.000001);
  closeTo(
    (snapshot.shareholders[0] as typeof snapshot.shareholders[0] & { cashPercent?: number })
      .cashPercent ?? 0,
    1 / 3,
    0.000001,
  );
  assert.deepEqual(
    snapshot.holdings
      .filter((holding) => holding.owner === "Ryu")
      .map((holding) => [holding.ticker, holding.quantity]),
    [
      ["AAPL", 14],
      ["MU", 1],
      ["NVDA", 18],
    ],
  );
  closeTo(snapshot.dividend.whtRate, 0.1, 0.000001);
});

test("recalculates a personal US-price scenario without changing shared-pool value", async () => {
  const snapshot = await loadSourceSnapshot();
  const scenario = createScenario(snapshot);
  scenario.fx = 33;
  scenario.prices.GOOGL = 330;
  scenario.prices.META = 540;

  const result = calculateDashboard(snapshot, scenario);
  const googleHoldings = result.holdings.filter((holding) => holding.ticker === "GOOGL");

  const metaHoldings = result.holdings.filter((holding) => holding.ticker === "META");
  assert.equal(googleHoldings.length, 2);
  assert.equal(metaHoldings.length, 2);
  const expectedGooglValue = 75 * 330 * 33;
  const expectedMetaValue = 42 * 540 * 33;
  const expectedOtherPersonalValue = snapshot.holdings
    .filter(
      (holding) =>
        holding.category === "personal" &&
        holding.ticker !== "GOOGL" &&
        holding.ticker !== "META",
    )
    .reduce(
      (total, holding) =>
        total + holding.quantity * (scenario.prices[holding.ticker] ?? 0) * scenario.fx,
      0,
    );
  const expectedPersonalValue = expectedGooglValue + expectedMetaValue + expectedOtherPersonalValue;
  closeTo(
    googleHoldings.reduce((total, holding) => total + holding.marketValue, 0),
    expectedGooglValue,
  );
  closeTo(
    metaHoldings.reduce((total, holding) => total + holding.marketValue, 0),
    expectedMetaValue,
  );
  closeTo(result.totals.sharedMarketValue, 248270.5);
  closeTo(result.totals.personalMarketValue, expectedPersonalValue);
  closeTo(result.totals.marketValue, 248270.5 + expectedPersonalValue);
});

test("uses current shared capital—not personal capital—to split the dividend forecast", async () => {
  const snapshot = await loadSourceSnapshot();
  const scenario = createScenario(snapshot);
  scenario.dividendDps.KBANK = 13;

  const result = calculateDashboard(snapshot, scenario);
  const mom = result.dividend.byOwner.find((owner) => owner.owner === "Mom");

  closeTo(result.dividend.gross, 8190);
  closeTo(result.dividend.wht, 819);
  closeTo(result.dividend.net, 7371);
  assert.ok(mom);
  closeTo(mom.net, 7371 * (1250000 / 2155932.19));
});

test("allocates free cash equally while keeping KBANK on the contributed pool percentages", async () => {
  const snapshot = await loadSourceSnapshot();
  const result = calculateDashboard(snapshot, createScenario(snapshot));
  const owners = calculateShareholderEquityRows(snapshot, result);
  const cashValue = result.holdings.find((holding) => holding.ticker === "CASH")?.marketValue ?? 0;
  const kbankValue = result.holdings.find((holding) => holding.ticker === "KBANK")?.marketValue ?? 0;

  for (const owner of owners) {
    closeTo(owner.cashMarketValue, cashValue / 3);
    closeTo(owner.sharedInvestmentMarketValue, kbankValue * owner.poolPercent);
    closeTo(
      owner.sharedMarketValue,
      owner.cashMarketValue + owner.sharedInvestmentMarketValue,
    );
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
