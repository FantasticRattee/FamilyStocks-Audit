import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  calculateDashboard,
  calculateShareholderEquityRows,
  createScenario,
  deriveSalePnlSummary,
  parseWorkbook,
  type DashboardSnapshot,
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

const loadSyntheticOverlaySnapshot = async (): Promise<DashboardSnapshot> => ({
  ...await loadSourceSnapshot(),
  holdings: [
    {
      ticker: "SPCX", account: "Shared-US", owner: null, category: "shared",
      currency: "USD", quantity: 65, avgCostThb: 4615.382,
      importedPriceThb: 4612.563774221466, costBasis: 299999.83,
    },
    {
      ticker: "SPCX", account: "Personal-US (Rattee)", owner: "Rattee", category: "personal",
      currency: "USD", quantity: 2, avgCostThb: 4451.21417,
      importedPriceThb: 4415.79866, costBasis: 8902.42834,
    },
    {
      ticker: "INTC", account: "Personal-US (Rattee)", owner: "Rattee", category: "personal",
      currency: "USD", quantity: 8, avgCostThb: 2873.3534375,
      importedPriceThb: 2864.49956, costBasis: 22986.8275,
    },
  ],
});

test("imports the pooled stock-audit workbook using labels and preserves its key totals", async () => {
  const snapshot = await loadSourceSnapshot();

  assert.equal(snapshot.asOfDate, "15 Sep 2026");
  assert.equal(snapshot.defaultFx, 33.254);
  closeTo(snapshot.summary.totalMarketValue, 3804744.5718840463);
  closeTo(snapshot.summary.sharedCapital, 3634606.003945636);
  closeTo(snapshot.summary.sharedMarketValue, 3804744.5718840463);
  closeTo(snapshot.summary.totalRealizedPnl, 556969.6541199738);
  closeTo(snapshot.summary.totalUnrealizedPnl, -29467.84187128622);
  closeTo(snapshot.summary.sharedUnrealizedPnl, -29467.84187128622);
  closeTo(snapshot.summary.totalPnl, 527501.8122486875);
  assert.deepEqual(snapshot.holdings.map((holding) => [holding.ticker, holding.quantity]), [
    ["ASML", 6],
    ["QQQI", 1190],
    ["GOOGL", 46],
    ["SPCX", 67],
    ["CASH", 1],
    ["VOO", 20.7758],
  ]);
  assert.ok(snapshot.holdings.every((holding) =>
    holding.category === "shared" && holding.owner === null &&
    holding.currency === (holding.ticker === "CASH" ? "THB" : "USD"),
  ));
  const cash = snapshot.holdings.find((holding) => holding.ticker === "CASH");
  assert.ok(cash);
  closeTo(cash.costBasis, 3211.59261, 0.000001);
  assert.deepEqual(
    snapshot.shareholders.map((holder) => holder.owner),
    ["Mom", "Ryu", "Rattee"],
  );
  assert.equal(snapshot.transactions[0].date, "2025-02-06");
  closeTo(snapshot.shareholders[0].poolPercent, 1870000 / 3634606.003945636, 0.000001);
  closeTo(
    snapshot.shareholders[0].cashPercent ?? 0,
    1870000 / 3634606.003945636,
    0.000001,
  );
  const rattee = snapshot.shareholders.find((holder) => holder.owner === "Rattee");
  assert.ok(rattee);
  closeTo(rattee.sharedCapital, 1464606.003945636);
  closeTo(rattee.totalInvested, 1464606.003945636);
  closeTo(snapshot.dividend.whtRate, 0.1, 0.000001);
});

test("preserves all 102 historical ledger rows through 24 August", async () => {
  const snapshot = await loadSourceSnapshot();
  const historical = snapshot.transactions.filter((transaction) => transaction.date <= "2026-08-24");

  assert.equal(historical.length, 102);
  // Frozen from the pre-update canonical ledger, including historical owner notes.
  assert.equal(
    createHash("sha256").update(JSON.stringify(historical)).digest("hex"),
    "275f2006b773b6e1f2a92276616a31dd7ea04d9286d15ea0195fac83aafe742a",
  );
  assert.equal(historical.at(-4)?.date, "2026-08-19");
  assert.equal(historical.at(-4)?.side, "BUY");
  assert.equal(historical.at(-4)?.ticker, "SPCX");
  assert.equal(historical.at(-4)?.account, "Shared-US");
  assert.equal(historical.at(-2)?.date, "2026-08-20");
  assert.equal(historical.at(-2)?.ticker, "SPCX");
  assert.equal(historical.at(-2)?.account, "Personal-US (Rattee)");
  assert.equal(historical.at(-1)?.date, "2026-08-24");
  assert.equal(historical.at(-1)?.ticker, "INTC");
});

test("preserves the 25 August contribution and the five earlier September trades", async () => {
  const snapshot = await loadSourceSnapshot();
  const additions = snapshot.transactions.filter((transaction) => transaction.date > "2026-08-24" && transaction.date <= "2026-09-09");

  assert.deepEqual(additions.map((transaction) => [
    transaction.date, transaction.account, transaction.ticker, transaction.side,
    transaction.quantity, transaction.priceNative, transaction.grossNative,
    transaction.currency, transaction.fx,
  ]), [
    ["2026-08-25", "Shared-TH", "CASH", "TRANSFER", 1, 5000, 5000, "THB", 1],
    ["2026-08-25", "Shared-US", "INTC", "BUY", 1, 89.03, 91.16, "USD", 33.254],
    ["2026-09-09", "Shared-US", "INTC", "SELL", 9, 105.07, 943.45, "USD", 33.254],
    ["2026-09-09", "Shared-US", "GOOGL", "BUY", 3, 329.5, 990.63, "USD", 33.254],
    ["2026-09-09", "Shared-US", "META", "SELL", 20, 650.5, 13007.17, "USD", 33.254],
    ["2026-09-09", "Shared-US", "VOO", "BUY", 18.6, 700.84, 13037.73, "USD", 33.254],
  ]);
  const deposits = snapshot.transactions.filter((transaction) =>
    transaction.date >= "2026-08-20" && transaction.date <= "2026-09-09" && transaction.ticker === "CASH" && transaction.side === "TRANSFER",
  );
  assert.deepEqual(deposits.map((transaction) => [
    transaction.date, transaction.costProceedsThb, transaction.realizedPnlThb,
  ]), [
    ["2026-08-20", 10000, 0],
    ["2026-08-25", 5000, 0],
  ]);
  closeTo(snapshot.summary.sharedCapital - 3309606.003945636 - 320000, 5000);
  const rattee = snapshot.shareholders.find((holder) => holder.owner === "Rattee");
  assert.ok(rattee);
  closeTo(rattee.sharedCapital - 1459606.003945636, 5000);

  for (const transaction of additions.filter((row) => row.currency === "USD")) {
    const sign = transaction.side === "SELL" ? 1 : -1;
    closeTo(transaction.costProceedsThb, sign * transaction.grossNative * 33.254, 0.000001);
  }
});

test("closes INTC and META using broker net proceeds and their remaining lot costs", async () => {
  const snapshot = await loadSourceSnapshot();
  const intcSales = snapshot.transactions.filter((row) =>
    row.date === "2026-09-09" && row.ticker === "INTC" && row.side === "SELL",
  );
  const metaSales = snapshot.transactions.filter((row) =>
    row.date === "2026-09-09" && row.ticker === "META" && row.side === "SELL",
  );
  assert.equal(intcSales.length, 1);
  assert.equal(metaSales.length, 1);
  const [intc] = intcSales;
  const [meta] = metaSales;
  const intcLots = snapshot.transactions.filter((row) =>
    ["2026-08-24", "2026-08-25"].includes(row.date) && row.ticker === "INTC" && row.side === "BUY",
  );
  assert.deepEqual(intcLots.map((row) => [row.quantity, row.grossNative]), [[8, 691.25], [1, 91.16]]);
  const metaLot = snapshot.transactions.find((row) =>
    row.date === "2026-08-12" && row.ticker === "META" && row.side === "BUY",
  );
  assert.ok(metaLot);
  assert.equal(metaLot.grossNative, 11660.73);
  assert.equal(intc.quantity, 9);
  assert.equal(meta.quantity, 20);
  closeTo(intc.costProceedsThb, 943.45 * 33.254, 0.000001);
  closeTo(meta.costProceedsThb, 13007.17 * 33.254, 0.000001);
  closeTo(intc.costProceedsThb - intc.realizedPnlThb, (691.25 + 91.16) * 33.254, 0.000001);
  closeTo(meta.costProceedsThb - meta.realizedPnlThb, 11660.73 * 33.254, 0.000001);
  closeTo(intc.realizedPnlThb, 5355.22416, 0.000001);
  closeTo(meta.realizedPnlThb, 44774.51576, 0.000001);
  closeTo(
    snapshot.summary.totalRealizedPnl - 512769.7674799737 - (2519.38 - 2697.70) * 33.254,
    intc.realizedPnlThb + meta.realizedPnlThb,
    0.000001,
  );
  assert.equal(snapshot.holdings.some((holding) => ["META", "INTC"].includes(holding.ticker)), false);
});

test("carries GOOGL and VOO broker fees in cost while preserving visible fill prices", async () => {
  const snapshot = await loadSourceSnapshot();
  const googl = snapshot.holdings.find((holding) => holding.ticker === "GOOGL");
  const voo = snapshot.holdings.find((holding) => holding.ticker === "VOO");
  assert.ok(googl);
  assert.ok(voo);
  assert.equal(googl.quantity, 46);
  assert.equal(voo.quantity, 20.7758);
  closeTo(googl.costBasis, 466482.6116253334 + (990.63 + 994.56) * 33.254, 0.000001);
  closeTo(voo.costBasis, (13037.73 + 1528.69) * 33.254, 0.000001);
  closeTo(googl.importedPriceThb, 330.81 * 33.254, 0.000001);
  closeTo(voo.importedPriceThb, 701.61 * 33.254, 0.000001);
  assert.ok(voo.costBasis > (18.6 * 700.84 + 2.1758 * 701.61) * 33.254);
});

test("prices all current Shared holdings without recreating closed META, INTC or AVGO", async () => {
  const snapshot = await loadSourceSnapshot();
  const scenario = createScenario(snapshot);
  scenario.fx = 33;
  scenario.prices.QQQI = 54;
  scenario.prices.GOOGL = 330;
  scenario.prices.META = 580;
  scenario.prices.AVGO = 390;
  scenario.prices.SPCX = 140;
  scenario.prices.INTC = 86;
  scenario.prices.VOO = 710;
  scenario.prices.ASML = 1600;

  const result = calculateDashboard(snapshot, scenario);
  assert.deepEqual(result.holdings.map((holding) => holding.ticker), [
    "ASML",
    "QQQI",
    "GOOGL",
    "SPCX",
    "CASH",
    "VOO",
  ]);
  assert.equal(result.holdings.some((holding) => ["NVDA", "META", "INTC", "AVGO"].includes(holding.ticker)), false);
  const cash = snapshot.holdings.find((holding) => holding.ticker === "CASH");
  assert.ok(cash);
  closeTo(
    result.holdings.find((holding) => holding.ticker === "CASH")?.marketValue ?? 0,
    cash.costBasis,
  );
  const expectedSharedMarketValue =
    cash.costBasis +
    1190 * 54 * 33 +
    46 * 330 * 33 +
    6 * 1600 * 33 +
    67 * 140 * 33 +
    20.7758 * 710 * 33;
  closeTo(result.totals.sharedMarketValue, expectedSharedMarketValue);
  closeTo(result.totals.personalMarketValue, 0);
  closeTo(result.totals.marketValue, expectedSharedMarketValue);
});

test("reconciles carried audit values after merging SPCX into the Shared pool", async () => {
  const snapshot = await loadSourceSnapshot();
  const result = calculateDashboard(snapshot, createScenario(snapshot));
  const spcx = result.holdings.filter((holding) => holding.ticker === "SPCX");

  assert.equal(spcx.length, 1);
  assert.equal(spcx[0].quantity, 67);
  closeTo(spcx[0].costBasis, 299999.83 + 8902.42834);
  closeTo(spcx[0].marketValue, 308648.2426443953);
  closeTo(result.totals.marketValue, snapshot.summary.totalMarketValue);
  closeTo(result.totals.unrealizedPnl, snapshot.summary.totalUnrealizedPnl);
  closeTo(result.totals.realizedPnl, snapshot.summary.totalRealizedPnl);
  closeTo(result.totals.totalPnl, snapshot.summary.totalPnl);
  closeTo(result.totals.personalMarketValue, 0);
});

test("preserves distinct audit marks for synthetic pooled and Rattee-specific overlays", async () => {
  const snapshot = await loadSyntheticOverlaySnapshot();
  const scenario = createScenario(snapshot);
  const result = calculateDashboard(snapshot, scenario);
  const pooledSpcx = result.holdings.find(
    (holding) => holding.ticker === "SPCX" && holding.category === "shared",
  );
  const personalSpcx = result.holdings.find(
    (holding) => holding.ticker === "SPCX" && holding.category === "personal",
  );

  assert.ok(pooledSpcx);
  assert.ok(personalSpcx);
  assert.equal(scenario.prices.SPCX, undefined);
  closeTo(pooledSpcx.marketValue, 65 * 4612.563774221466);
  closeTo(personalSpcx.marketValue, 2 * 4415.7986599999995);
  closeTo(result.totals.personalMarketValue, 2 * 4415.79866 + 8 * 2864.49956);
});

test("prices synthetic overlays and assigns their value only to the named owner", async () => {
  const snapshot = await loadSyntheticOverlaySnapshot();
  const scenario = createScenario(snapshot);
  scenario.fx = 33;
  scenario.prices.SPCX = 140;
  scenario.prices.INTC = 86;
  const result = calculateDashboard(snapshot, scenario);
  const owners = calculateShareholderEquityRows(snapshot, result);
  const expectedSharedValue = 65 * 140 * 33;
  const expectedPersonalValue = 2 * 140 * 33 + 8 * 86 * 33;

  closeTo(result.totals.sharedMarketValue, expectedSharedValue);
  closeTo(result.totals.personalMarketValue, expectedPersonalValue);
  closeTo(result.totals.marketValue, expectedSharedValue + expectedPersonalValue);
  for (const owner of owners) {
    const personalValue = owner.owner === "Rattee" ? expectedPersonalValue : 0;
    closeTo(owner.personalMarketValue, personalValue);
    closeTo(owner.estimatedEquity, expectedSharedValue * owner.poolPercent + personalValue);
  }
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
  closeTo(mom.net, 7371 * (1870000 / 3634606.003945636));
});

test("allocates every active pooled asset by total contributed-capital percentage", async () => {
  const snapshot = await loadSourceSnapshot();
  const result = calculateDashboard(snapshot, createScenario(snapshot));
  const owners = calculateShareholderEquityRows(snapshot, result);
  const cashValue = result.holdings.find((holding) => holding.ticker === "CASH")?.marketValue ?? 0;
  const investmentValue = result.totals.sharedMarketValue - cashValue;
  closeTo(result.totals.personalMarketValue, 0);

  for (const owner of owners) {
    closeTo(owner.poolPercent, owner.sharedCapital / 3634606.003945636, 0.000001);
    closeTo(owner.cashMarketValue, cashValue * owner.poolPercent);
    closeTo(owner.sharedInvestmentMarketValue, investmentValue * owner.poolPercent);
    closeTo(
      owner.sharedMarketValue,
      owner.cashMarketValue + owner.sharedInvestmentMarketValue,
    );
    closeTo(owner.personalMarketValue, 0);
    closeTo(
      owner.estimatedEquity,
      owner.sharedMarketValue,
    );
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
