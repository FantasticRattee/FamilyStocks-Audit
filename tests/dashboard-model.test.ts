import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  calculateDashboard,
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

  assert.equal(snapshot.asOfDate, "1 Aug 2026");
  closeTo(snapshot.summary.totalMarketValue, 4087515.1548);
  closeTo(snapshot.summary.sharedCapital, 2155932.19);
  closeTo(snapshot.summary.sharedMarketValue, 2473548);
  closeTo(snapshot.summary.totalRealizedPnl, 367145.9831482768);
  assert.deepEqual(
    snapshot.holdings.map((holding) => holding.ticker).sort(),
    ["CASH", "GOOGL", "GOOGL", "KBANK", "META", "META"],
  );
  assert.deepEqual(
    snapshot.shareholders.map((holder) => holder.owner),
    ["Mom", "Ryu", "Rattee"],
  );
  assert.equal(snapshot.transactions[0].date, "2025-02-06");
  assert.equal(snapshot.transactions.at(-1)?.date, "2026-08-01");
  closeTo(snapshot.shareholders[0].poolPercent, 0.5797956010852086, 0.000001);
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
  const expectedPersonalValue = expectedGooglValue + expectedMetaValue;
  closeTo(
    googleHoldings.reduce((total, holding) => total + holding.marketValue, 0),
    expectedGooglValue,
  );
  closeTo(
    metaHoldings.reduce((total, holding) => total + holding.marketValue, 0),
    expectedMetaValue,
  );
  closeTo(result.totals.sharedMarketValue, 2473548);
  closeTo(result.totals.personalMarketValue, expectedPersonalValue);
  closeTo(result.totals.marketValue, 2473548 + expectedPersonalValue);
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

test("rejects a file that cannot be read as the required audit workbook", () => {
  assert.throws(
    () => parseWorkbook(new Uint8Array([1, 2, 3, 4]).buffer, "bad.xlsx"),
    /workbook|xlsx|sheet/i,
  );
});
