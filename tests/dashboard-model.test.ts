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

  assert.equal(snapshot.asOfDate, "15 Jun 2026");
  closeTo(snapshot.summary.totalMarketValue, 3132588.42);
  closeTo(snapshot.summary.sharedCapital, 2155932.19);
  closeTo(snapshot.summary.sharedMarketValue, 2485374);
  closeTo(snapshot.summary.totalRealizedPnl, 33871.68157610536);
  assert.deepEqual(
    snapshot.holdings.map((holding) => holding.ticker).sort(),
    ["GOOGL", "GOOGL", "KBANK", "SCB"],
  );
  assert.deepEqual(
    snapshot.shareholders.map((holder) => holder.owner),
    ["Mom", "Ryu", "Rattee"],
  );
  assert.equal(snapshot.transactions[0].date, "2025-05-13");
  assert.equal(snapshot.transactions.at(-1)?.date, "2026-07-15");
  closeTo(snapshot.shareholders[0].poolPercent, 0.5797956010852086, 0.000001);
  closeTo(snapshot.dividend.whtRate, 0.1, 0.000001);
});

test("recalculates a personal US-price scenario without changing shared-pool value", async () => {
  const snapshot = await loadSourceSnapshot();
  const scenario = createScenario(snapshot);
  scenario.fx = 33;
  scenario.prices.GOOGL = 330;

  const result = calculateDashboard(snapshot, scenario);
  const googleHoldings = result.holdings.filter((holding) => holding.ticker === "GOOGL");

  assert.equal(googleHoldings.length, 2);
  const expectedPersonalValue = 54 * 330 * 33;
  closeTo(googleHoldings[0].marketValue + googleHoldings[1].marketValue, expectedPersonalValue);
  closeTo(result.totals.sharedMarketValue, 2485374);
  closeTo(result.totals.personalMarketValue, expectedPersonalValue);
  closeTo(result.totals.marketValue, 2485374 + expectedPersonalValue);
});

test("uses current shared capital—not personal capital—to split the dividend forecast", async () => {
  const snapshot = await loadSourceSnapshot();
  const scenario = createScenario(snapshot);
  scenario.dividendDps.SCB = 10;

  const result = calculateDashboard(snapshot, scenario);
  const mom = result.dividend.byOwner.find((owner) => owner.owner === "Mom");

  closeTo(result.dividend.gross, 157550);
  closeTo(result.dividend.wht, 15755);
  closeTo(result.dividend.net, 141795);
  assert.ok(mom);
  closeTo(mom.net, 141795 * (1250000 / 2155932.19));
});

test("rejects a file that cannot be read as the required audit workbook", () => {
  assert.throws(
    () => parseWorkbook(new Uint8Array([1, 2, 3, 4]).buffer, "bad.xlsx"),
    /workbook|xlsx|sheet/i,
  );
});
