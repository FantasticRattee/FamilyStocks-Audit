import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as XLSX from "xlsx";

import {
  calculateDashboard,
  createScenario,
  parseWorkbook,
} from "../app/dashboard/model";
import {
  buildDashboardSnapshotFromSharedPortfolio,
  parseWorkbookForImport,
  validatePortfolioSettings,
} from "../app/dashboard/shared-portfolio";

const sourceWorkbook = new URL("../../Portfolio_Accounting.xlsx", import.meta.url);
const closeTo = (actual: number, expected: number, tolerance = 1e-7) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

const mixedFxWorkbook = async () => {
  const bytes = await readFile(sourceWorkbook);
  const workbook = XLSX.read(bytes, { type: "buffer", cellDates: false });
  const holdings = XLSX.utils.sheet_to_json(workbook.Sheets.Holdings, {
    header: 1,
    raw: true,
    defval: null,
  }) as unknown[][];
  const headerIndex = holdings.findIndex((row) =>
    row.some((value) => String(value ?? "").toLowerCase().includes("ticker")) &&
    row.some((value) => String(value ?? "").toLowerCase().includes("avg cost")) &&
    row.some((value) => String(value ?? "").toLowerCase().includes("cur price")),
  );
  assert.notEqual(headerIndex, -1, "canonical Holdings header exists");
  holdings[headerIndex][8] = "Avg Cost (Native)";
  holdings[headerIndex][9] = "Cur Price (Native)";
  const column = (fragment: string) =>
    holdings[headerIndex].findIndex((value) =>
      String(value ?? "").toLowerCase().includes(fragment),
    );
  const tickerColumn = column("ticker");
  const quantityColumn = column("qty");
  const averageCostColumn = column("avg cost");
  const currentPriceColumn = column("cur price");
  const accountColumn = column("account");
  const nativeAverageCostColumn = 8;
  const nativePriceColumn = 9;

  for (const row of holdings.slice(headerIndex + 1)) {
    const ticker = String(row[tickerColumn] ?? "").trim().toUpperCase();
    if (ticker === "NVDA") {
      row[quantityColumn] = 174;
      row[averageCostColumn] = 1_305_588.67675 / 174;
      row[currentPriceColumn] = 221.12 * 33.687;
      row[nativeAverageCostColumn] = 39_154.53 / 174;
      row[nativePriceColumn] = 221.12;
    } else if (["QQQ", "ORCL", "MU"].includes(ticker)) {
      const nativeAverageCost = ticker === "QQQ"
        ? 60_999.03 / 82
        : ticker === "ORCL"
          ? 15_335.17 / 110
          : 12_181.96 / 13;
      const nativePrice = ticker === "QQQ" ? 743.8 : ticker === "ORCL" ? 143.3 : 936.91;
      row[nativeAverageCostColumn] = nativeAverageCost;
      row[nativePriceColumn] = nativePrice;
      row[currentPriceColumn] = nativePrice * 33.254;
    }
    if (ticker === "NVDA" && accountColumn < 0) {
      throw new Error("canonical account column exists");
    }
  }
  workbook.Sheets.Holdings = XLSX.utils.aoa_to_sheet(holdings);

  const transactions = XLSX.utils.sheet_to_json(workbook.Sheets.Transactions, {
    header: 1,
    raw: true,
    defval: null,
  }) as unknown[][];
  const transactionHeader = transactions.findIndex((row) =>
    row.some((value) => String(value ?? "").toLowerCase().includes("date")) &&
    row.some((value) => String(value ?? "").toLowerCase().includes("ticker")) &&
    row.some((value) => String(value ?? "").toLowerCase().includes("fx")),
  );
  assert.notEqual(transactionHeader, -1, "canonical Transactions header exists");
  const fxColumn = transactions[transactionHeader].findIndex((value) =>
    String(value ?? "").toLowerCase().includes("fx"),
  );
  const lastUsdRow = transactions.slice(transactionHeader + 1).findLast((row) =>
    String(row[0] ?? "").toLowerCase() !== "total" &&
    String(row).toUpperCase().includes("NVDA") &&
    row.some((value) => String(value ?? "").toUpperCase() === "USD"),
  );
  assert.ok(lastUsdRow, "a prior NVDA USD transaction exists");
  lastUsdRow[fxColumn] = 33.687;
  workbook.Sheets.Transactions = XLSX.utils.aoa_to_sheet(transactions);

  return XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
};

const workbookWithInvalidNativeValue = async (column: number, value: unknown) => {
  const workbook = XLSX.read(await mixedFxWorkbook(), { type: "array", cellDates: false });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Holdings, {
    header: 1,
    raw: true,
    defval: null,
  }) as unknown[][];
  const tickerRow = rows.find((row) => String(row[0] ?? "").trim().toUpperCase() === "NVDA");
  assert.ok(tickerRow, "active NVDA row exists");
  tickerRow[column] = value;
  workbook.Sheets.Holdings = XLSX.utils.aoa_to_sheet(rows);
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
};

test("canonical mixed-FX basis and source-native mark survive import and reporting-FX changes", async () => {
  const bytes = await mixedFxWorkbook();
  const parsed = parseWorkbook(bytes, "mixed-fx.xlsx");
  assert.equal(parsed.defaultFx, 33.687);

  const imported = parseWorkbookForImport(bytes, "mixed-fx.xlsx");
  assert.equal(imported.source, "audit");
  assert.ok(imported.settings);
  const nvdaInput = imported.holdings.find((holding) => holding.ticker === "NVDA");
  assert.ok(nvdaInput);
  closeTo(nvdaInput.entryPrice, 39_154.53 / 174);

  const snapshot = buildDashboardSnapshotFromSharedPortfolio(
    imported.holdings,
    imported.settings,
    imported.filename,
  );
  const nvda = snapshot.holdings.find((holding) => holding.ticker === "NVDA");
  assert.ok(nvda);
  closeTo(nvda.avgCostThb, 1_305_588.67675 / 174);
  closeTo(nvda.costBasis, 1_305_588.67675);
  closeTo(nvda.avgCostNative ?? NaN, 39_154.53 / 174);
  closeTo(nvda.importedPriceNative ?? NaN, 221.12);

  const referenceFxSnapshot = buildDashboardSnapshotFromSharedPortfolio(
    imported.holdings,
    { ...imported.settings, defaultFx: 33.254 },
    imported.filename,
  );
  const referenceNvda = referenceFxSnapshot.holdings.find((holding) => holding.ticker === "NVDA");
  assert.ok(referenceNvda);
  closeTo(referenceNvda.avgCostThb, 1_305_588.67675 / 174);
  closeTo(referenceNvda.costBasis, 1_305_588.67675);
  closeTo(referenceNvda.importedPriceThb, 221.12 * 33.254);
  const scenario = createScenario(referenceFxSnapshot);
  closeTo(scenario.prices.NVDA, 221.12);
  const result = calculateDashboard(referenceFxSnapshot, scenario);
  const calculatedNvda = result.holdings.find((holding) => holding.ticker === "NVDA");
  assert.ok(calculatedNvda);
  closeTo(calculatedNvda.priceNative, 221.12);
  closeTo(calculatedNvda.currentPriceThb, 221.12 * 33.254);
  closeTo(calculatedNvda.costBasis, 1_305_588.67675);
});

test("changed holding fingerprints do not reuse canonical THB basis or native marks", async () => {
  const bytes = await mixedFxWorkbook();
  const imported = parseWorkbookForImport(bytes, "mixed-fx.xlsx");
  assert.ok(imported.settings);
  const editedHoldings = imported.holdings.map((holding) =>
    holding.ticker === "NVDA"
      ? { ...holding, entryPrice: holding.entryPrice + 0.01 }
      : holding,
  );
  const rebuilt = buildDashboardSnapshotFromSharedPortfolio(
    editedHoldings,
    imported.settings,
    imported.filename,
  );
  const nvda = rebuilt.holdings.find((holding) => holding.ticker === "NVDA");
  assert.ok(nvda);
  closeTo(nvda.avgCostThb, (39_154.53 / 174 + 0.01) * 33.687);
  assert.equal(nvda.importedPriceNative, undefined);
});

test("malformed provided audit holding metadata is rejected with a field-specific error", async () => {
  const imported = parseWorkbookForImport(await mixedFxWorkbook(), "mixed-fx.xlsx");
  assert.ok(imported.settings);
  assert.throws(
    () => validatePortfolioSettings({
      ...imported.settings,
      auditHoldings: [{
        ticker: "NVDA",
        ownerAccount: "Shared",
        units: 174,
        entryPrice: 39_154.53 / 174,
        avgCostThb: "not-a-number",
        importedPriceNative: 221.12,
      }],
    }),
    /auditHoldings\[0\]\.avgCostThb must be a finite number/i,
  );
  assert.throws(
    () => validatePortfolioSettings({ ...imported.settings, auditHoldings: null }),
    /auditHoldings must be an array/i,
  );
  const legacySettings = validatePortfolioSettings({
    ...imported.settings,
    auditHoldings: undefined,
  });
  assert.equal(legacySettings.auditHoldings, undefined);
});

test("duplicate audit holding fingerprints are rejected instead of choosing one basis", async () => {
  const imported = parseWorkbookForImport(await mixedFxWorkbook(), "mixed-fx.xlsx");
  assert.ok(imported.settings?.auditHoldings?.length);
  const duplicate = imported.settings.auditHoldings[0];
  assert.throws(
    () => validatePortfolioSettings({
      ...imported.settings,
      auditHoldings: [duplicate, { ...duplicate, avgCostThb: duplicate.avgCostThb + 1 }],
    }),
    /auditHoldings.*duplicate fingerprint.*NVDA|auditHoldings.*duplicate fingerprint/i,
  );
});

test("invalid active native cost or price cells fail explicitly instead of using reporting FX", async () => {
  for (const [column, value, label] of [
    [8, "not-a-number", "Avg Cost (Native)"],
    [9, null, "Cur Price (Native)"],
    [9, 0, "Cur Price (Native)"],
  ] as const) {
    const bytes = await workbookWithInvalidNativeValue(column, value);
    assert.throws(
      () => parseWorkbook(bytes, "invalid-native.xlsx"),
      new RegExp(`NVDA.*${label.replace(/[()]/g, "\\$&")}.*positive finite`, "i"),
    );
  }
});

test("canonical workbooks without native columns retain the legacy fallback", async () => {
  const bytes = await mixedFxWorkbook();
  const workbook = XLSX.read(bytes, { type: "array", cellDates: false });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Holdings, {
    header: 1,
    raw: true,
    defval: null,
  }) as unknown[][];
  workbook.Sheets.Holdings = XLSX.utils.aoa_to_sheet(rows.map((row) => row.slice(0, 8)));
  const legacyBytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const snapshot = parseWorkbook(legacyBytes, "legacy.xlsx");
  const nvda = snapshot.holdings.find((holding) => holding.ticker === "NVDA");
  assert.ok(nvda);
  assert.equal(nvda.avgCostNative, undefined);
  assert.equal(nvda.importedPriceNative, undefined);
  closeTo(nvda.avgCostThb, 1_305_588.67675 / 174);
  closeTo(createScenario(snapshot).prices.NVDA, nvda.importedPriceThb / snapshot.defaultFx);
});
