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

test("uses the current-capital forecast rather than the historical payout", async () => {
  const snapshot = await loadSourceSnapshot();
  const result = calculateDashboard(snapshot, createScenario(snapshot));

  assert.equal(snapshot.dividend.basis, "current-capital");
  assert.deepEqual(
    snapshot.dividend.lines.map((line) => [line.ticker, line.eligibleQuantity, line.dps]),
    [
      ["SCB", 14999, 11.28],
      ["KBANK", 630, 12],
    ],
  );
  closeTo(snapshot.dividend.costBasis, 2155932.19);
  closeTo(result.dividend.gross, 176748.72);
  closeTo(result.dividend.net, 159073.848);
  closeTo(snapshot.historicalDividend.net, 64519.2);

  const mom = result.dividend.byOwner.find((owner) => owner.owner === "Mom");
  assert.ok(mom);
  closeTo(mom.net, 92230.31731809709);
  closeTo(mom.capitalPercent, 1250000 / 2155932.19, 0.000001);
});

test("recalculates the forecast when current shareholder capital increases", async () => {
  const snapshot = await loadSourceSnapshot();
  const baseline = calculateDashboard(snapshot, createScenario(snapshot));

  snapshot.shareholders[0].sharedCapital += 100000;
  const result = calculateDashboard(snapshot, createScenario(snapshot));
  const expectedYield = 176748.72 / 2155932.19;
  const expectedCapital = 2255932.19;
  const mom = result.dividend.byOwner.find((owner) => owner.owner === "Mom");

  assert.ok(result.dividend.gross > baseline.dividend.gross);
  closeTo(result.dividend.gross, expectedCapital * expectedYield);
  assert.ok(mom);
  closeTo(mom.capitalPercent, 1350000 / expectedCapital, 0.000001);
});
