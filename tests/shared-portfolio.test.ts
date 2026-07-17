import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import XLSX from "xlsx";

import {
  MINIMAL_HOLDINGS_HEADERS,
  buildDashboardSnapshotFromSharedPortfolio,
  exportMinimalHoldingsWorkbook,
  parseMinimalHoldingsWorkbook,
  validatePortfolioSettings,
  validateSharedHoldings,
  type PortfolioSettings,
  type SharedHoldingInput,
} from "../app/dashboard/shared-portfolio";

const holdings: SharedHoldingInput[] = [
  { ticker: "GOOGL", ownerAccount: "Mom", entryPrice: 365.65, units: 33 },
  { ticker: "GOOGL", ownerAccount: "Rattee", entryPrice: 365.65, units: 21 },
  { ticker: "SCB", ownerAccount: "Shared", entryPrice: 136.1, units: 14_999 },
  { ticker: "KBANK", ownerAccount: "Shared", entryPrice: 181.8, units: 630 },
];

const settings: PortfolioSettings = {
  schemaVersion: 1,
  asOfDate: "16 Jul 2026",
  defaultFx: 33.3383,
  totalRealizedPnl: 33_871.68,
  shareholders: [
    {
      owner: "Mom",
      sharedCapital: 1_250_000,
      poolPercent: 0.58,
      personalCapital: 402_272.28,
      totalInvested: 1_652_272.28,
    },
    {
      owner: "Rattee",
      sharedCapital: 605_932.19,
      poolPercent: 0.281,
      personalCapital: 255_991.45,
      totalInvested: 861_923.64,
    },
    {
      owner: "Ryu",
      sharedCapital: 300_000,
      poolPercent: 0.139,
      personalCapital: 0,
      totalInvested: 300_000,
    },
  ],
  dividend: {
    whtRate: 0.1,
    lines: [
      { ticker: "SCB", dps: 11.28, note: "FY2025 annual" },
      { ticker: "KBANK", dps: 12, note: "FY2025 ordinary" },
    ],
  },
  historicalDividend: { whtRate: 0.1, lines: [], gross: 0, wht: 0, net: 0 },
  transactions: [],
};

const workbookBytes = (rows: unknown[][]) => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(rows),
    "Holdings",
  );
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
};

const canonicalAuditWorkbook = new URL(
  "../../Portfolio_Accounting.xlsx",
  import.meta.url,
);

test("imports the canonical six-sheet audit workbook as a full portfolio update", async () => {
  const file = await readFile(canonicalAuditWorkbook);
  const parsed = parseMinimalHoldingsWorkbook(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
    "Portfolio_Accounting.xlsx",
  ) as {
    filename: string;
    holdings: SharedHoldingInput[];
    settings?: PortfolioSettings;
  };

  assert.equal(parsed.filename, "Portfolio_Accounting.xlsx");
  assert.deepEqual(
    parsed.holdings.map((holding) => [holding.ticker, holding.ownerAccount, holding.units]),
    [
      ["GOOGL", "Mom", 33],
      ["GOOGL", "Rattee", 31],
      ["SCB", "Shared", 14_999],
      ["KBANK", "Shared", 630],
    ],
  );
  assert.ok(parsed.settings);
  assert.deepEqual(validatePortfolioSettings(parsed.settings), parsed.settings);
  assert.equal(parsed.settings?.asOfDate, "18 Jul 2026");
  assert.equal(parsed.settings?.shareholders.find((holder) => holder.owner === "Rattee")?.totalInvested, 977_923.6416283695);
  assert.equal(parsed.settings?.transactions.at(-1)?.date, "2026-07-18");
});

test("uses exactly the approved four-column raw holdings contract", () => {
  assert.deepEqual(MINIMAL_HOLDINGS_HEADERS, [
    "Ticker",
    "Owner/Account",
    "Entry Price",
    "Units",
  ]);

  const parsed = parseMinimalHoldingsWorkbook(
    workbookBytes([
      MINIMAL_HOLDINGS_HEADERS,
      [" googl ", "Me", 365.65, 21],
      ["SCB", "Shared", 136.1, 14_999],
    ]),
    "holdings.xlsx",
  );

  assert.deepEqual(parsed.holdings, [
    { ticker: "GOOGL", ownerAccount: "Rattee", entryPrice: 365.65, units: 21 },
    { ticker: "SCB", ownerAccount: "Shared", entryPrice: 136.1, units: 14_999 },
  ]);
  assert.equal(parsed.filename, "holdings.xlsx");
});

test("rejects derived columns, unsupported tickers, and invalid numeric inputs", () => {
  assert.throws(
    () =>
      parseMinimalHoldingsWorkbook(
        workbookBytes([
          [...MINIMAL_HOLDINGS_HEADERS, "Current Price"],
          ["GOOGL", "Rattee", 365.65, 21, 372.49],
        ]),
        "derived.xlsx",
      ),
    /exactly|current price|header/i,
  );

  assert.throws(
    () =>
      validateSharedHoldings([
        { ticker: "AAPL", ownerAccount: "Rattee", entryPrice: 200, units: 1 },
      ]),
    /row 2.*AAPL.*supported/i,
  );
  assert.throws(
    () =>
      validateSharedHoldings([
        { ticker: "SCB", ownerAccount: "Shared", entryPrice: 0, units: 10 },
      ]),
    /row 2.*entry price.*positive/i,
  );
});

test("exports a fresh one-sheet workbook with no derived attributes", () => {
  const exported = exportMinimalHoldingsWorkbook(holdings, {
    exportedAt: "2026-07-16T00:00:00.000Z",
  });
  const workbook = XLSX.read(exported.bytes, { type: "array" });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Holdings, {
    header: 1,
    raw: true,
  }) as unknown[][];

  assert.deepEqual(workbook.SheetNames, ["Holdings"]);
  assert.deepEqual(rows[0], MINIMAL_HOLDINGS_HEADERS);
  assert.deepEqual(rows.slice(1), holdings.map((holding) => [
    holding.ticker,
    holding.ownerAccount,
    holding.entryPrice,
    holding.units,
  ]));
  assert.doesNotMatch(JSON.stringify(rows), /current price|market value|p&l|dividend/i);
  assert.match(exported.filename, /^Portfolio_Holdings_2026-07-16\.xlsx$/);
});

test("derives dashboard holdings, THB cost basis, and dividend quantities from raw rows", () => {
  const snapshot = buildDashboardSnapshotFromSharedPortfolio(
    holdings,
    settings,
    "Shared_Portfolio.xlsx",
  );

  assert.deepEqual(
    snapshot.holdings.map((holding) => ({
      ticker: holding.ticker,
      owner: holding.owner,
      category: holding.category,
      currency: holding.currency,
      quantity: holding.quantity,
    })),
    [
      { ticker: "GOOGL", owner: "Mom", category: "personal", currency: "USD", quantity: 33 },
      { ticker: "GOOGL", owner: "Rattee", category: "personal", currency: "USD", quantity: 21 },
      { ticker: "SCB", owner: null, category: "shared", currency: "THB", quantity: 14_999 },
      { ticker: "KBANK", owner: null, category: "shared", currency: "THB", quantity: 630 },
    ],
  );
  assert.equal(snapshot.holdings[0].avgCostThb, 365.65 * settings.defaultFx);
  assert.equal(snapshot.holdings[2].costBasis, 136.1 * 14_999);
  assert.deepEqual(
    snapshot.dividend.lines.map((line) => [line.ticker, line.eligibleQuantity]),
    [
      ["SCB", 14_999],
      ["KBANK", 630],
    ],
  );
});
