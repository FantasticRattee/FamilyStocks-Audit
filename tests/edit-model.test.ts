import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildWorkbookEditRequest,
  createHoldingEdits,
} from "../app/dashboard/edit-model";
import { createScenario, parseWorkbook } from "../app/dashboard/model";

const sourceWorkbook = new URL(
  "../../Portfolio_Accounting.xlsx",
  import.meta.url,
);

test("turns a selected Yahoo candidate and edited price into a safe export request", async () => {
  const file = await readFile(sourceWorkbook);
  const snapshot = parseWorkbook(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
    "Portfolio_Accounting.xlsx",
  );
  const scenario = createScenario(snapshot);
  scenario.prices.GOOGL = 333.25;
  scenario.fx = 33;
  scenario.dividendDps.SCB = 10;
  scenario.whtRate = 0.07;

  const edits = createHoldingEdits(snapshot);
  edits.GOOGL = {
    ...edits.GOOGL,
    targetTicker: "GOOGL.NEW",
    priceSource: "Yahoo Finance",
    selectedCandidate: {
      symbol: "GOOGL.NEW",
      name: "Alphabet Test Inc",
      exchange: "NYQ",
      currency: "USD",
      quoteType: "EQUITY",
    },
    quote: {
      symbol: "GOOGL.NEW",
      price: 333.25,
      currency: "USD",
      exchange: "NYQ",
      marketState: "REGULAR",
      quoteTimestamp: "2026-07-15T10:29:00.000Z",
    },
  };

  const request = buildWorkbookEditRequest(snapshot, scenario, edits, "2026-07-15T10:30:00.000Z");

  assert.deepEqual(request.renames, [{ from: "GOOGL", to: "GOOGL.NEW" }]);
  assert.deepEqual(request.priceUpdates.find((update) => update.ticker === "GOOGL"), {
    ticker: "GOOGL",
    priceNative: 333.25,
    currency: "USD",
    fx: 33,
    source: "Yahoo Finance",
    yahooSymbol: "GOOGL.NEW",
    companyName: "Alphabet Test Inc",
    quoteTimestamp: "2026-07-15T10:29:00.000Z",
  });
  assert.deepEqual(
    request.priceUpdates.map((update) => update.ticker).sort(),
    ["GOOGL"],
  );
  assert.deepEqual(request.dividendUpdates, [{ ticker: "SCB", dps: 10 }]);
  assert.equal(request.whtRate, 0.07);
});

test("exports all USD holding prices when FX changes even if their native prices do not", async () => {
  const file = await readFile(sourceWorkbook);
  const snapshot = parseWorkbook(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
    "Portfolio_Accounting.xlsx",
  );
  const scenario = createScenario(snapshot);
  scenario.fx = 33;

  const request = buildWorkbookEditRequest(
    snapshot,
    scenario,
    createHoldingEdits(snapshot),
    "2026-07-15T10:30:00.000Z",
  );

  assert.deepEqual(
    request.priceUpdates.map((update) => update.ticker).sort(),
    ["GOOGL"],
  );
  assert.ok(request.priceUpdates.every((update) => update.fx === 33));
});
