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

test("accepts an INTC holding and Rattee-specific SPCX overlay", () => {
  const parsed = parseMinimalHoldingsWorkbook(
    workbookBytes([
      [...MINIMAL_HOLDINGS_HEADERS],
      ["SPCX", "Shared", 140, 65],
      ["SPCX", "Rattee", 132.79, 2],
      ["INTC", "Rattee", 86.14, 8],
      ["CASH", "Shared", 1257.24307, 1],
    ]),
    "new-holdings.xlsx",
  );

  assert.deepEqual(
    parsed.holdings.map((holding) => [holding.ticker, holding.ownerAccount, holding.units]),
    [
      ["SPCX", "Shared", 65],
      ["SPCX", "Rattee", 2],
      ["INTC", "Rattee", 8],
      ["CASH", "Shared", 1],
    ],
  );
});

test("imports a fractional shared VOO holding as a USD native-price position", () => {
  const parsed = parseMinimalHoldingsWorkbook(
    workbookBytes([
      [...MINIMAL_HOLDINGS_HEADERS],
      ["VOO", "Shared", 700.84, 18.6],
    ]),
    "voo-holding.xlsx",
  );

  assert.deepEqual(parsed.holdings, [
    { ticker: "VOO", ownerAccount: "Shared", entryPrice: 700.84, units: 18.6 },
  ]);

  const snapshot = buildDashboardSnapshotFromSharedPortfolio(
    parsed.holdings,
    settings,
    parsed.filename,
  );
  assert.deepEqual(snapshot.holdings[0], {
    ticker: "VOO",
    account: "Shared-USD",
    owner: null,
    category: "shared",
    currency: "USD",
    quantity: 18.6,
    avgCostThb: 700.84 * settings.defaultFx,
    importedPriceThb: 700.84 * settings.defaultFx,
    costBasis: 18.6 * 700.84 * settings.defaultFx,
  });
});

test("round-trips fractional VOO through the minimal export adapter", () => {
  const voo: SharedHoldingInput[] = [
    { ticker: "VOO", ownerAccount: "Shared", entryPrice: 700.84, units: 18.6 },
  ];
  const exported = exportMinimalHoldingsWorkbook(voo, {
    exportedAt: "2026-09-10T00:00:00.000Z",
  });
  const imported = parseMinimalHoldingsWorkbook(exported.bytes, exported.filename);

  assert.deepEqual(imported.holdings, voo);
});

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
      ["QQQI", "Shared", 1190],
      ["GOOGL", "Shared", 43],
      ["AVGO", "Shared", 6.9162],
      ["SPCX", "Shared", 67],
      ["CASH", "Shared", 1],
      ["VOO", "Shared", 18.6],
    ],
  );
  assert.ok(parsed.settings);
  assert.deepEqual(validatePortfolioSettings(parsed.settings), parsed.settings);
  assert.equal(parsed.settings.asOfDate, "9 Sep 2026");
  assert.equal(parsed.settings.defaultFx, 33.254);
  assert.ok(Math.abs(parsed.settings.totalRealizedPnl - 562899.5073999737) < 0.000001);
  assert.ok(Math.abs(
    parsed.settings.shareholders.reduce((total, holder) => total + holder.sharedCapital, 0) -
      3314606.003945636,
  ) < 0.000001);
  assert.ok(
    Math.abs(
      (parsed.settings.shareholders.find((holder) => holder.owner === "Rattee")?.totalInvested ?? 0) -
        1_464_606.003945636,
    ) < 0.01,
  );
  const historical = parsed.settings.transactions.filter((transaction) => transaction.date <= "2026-08-24");
  assert.equal(historical.at(-4)?.date, "2026-08-19");
  assert.equal(historical.at(-4)?.side, "BUY");
  assert.equal(historical.at(-4)?.ticker, "SPCX");
  assert.equal(historical.at(-4)?.account, "Shared-US");
  assert.equal(historical.at(-2)?.date, "2026-08-20");
  assert.equal(historical.at(-2)?.ticker, "SPCX");
  assert.equal(historical.at(-2)?.account, "Personal-US (Rattee)");
  assert.equal(historical.at(-1)?.date, "2026-08-24");
  assert.equal(historical.at(-1)?.ticker, "INTC");
  const latest = parsed.settings.transactions.at(-1);
  assert.equal(latest?.date, "2026-09-09");
  assert.equal(latest?.ticker, "VOO");
  assert.equal(latest?.quantity, 18.6);
  assert.equal(latest?.priceNative, 700.84);
  assert.equal(latest?.grossNative, 13037.73);

  const cash = parsed.holdings.find((holding) => holding.ticker === "CASH");
  const voo = parsed.holdings.find((holding) => holding.ticker === "VOO");
  assert.ok(cash);
  assert.ok(voo);
  assert.ok(Math.abs(cash.entryPrice - 640.64247) < 0.000001);
  assert.ok(Math.abs(voo.entryPrice * voo.units - 13037.73) < 0.000001);
  assert.ok(voo.entryPrice > 700.84);
  const exported = exportMinimalHoldingsWorkbook(parsed.holdings);
  assert.deepEqual(
    parseMinimalHoldingsWorkbook(exported.bytes, exported.filename).holdings,
    parsed.holdings,
  );
  const snapshot = buildDashboardSnapshotFromSharedPortfolio(
    parsed.holdings,
    parsed.settings,
    parsed.filename,
  );
  assert.ok(snapshot.holdings.every((holding) => holding.category === "shared" && holding.owner === null));
  assert.ok(Math.abs(
    (snapshot.holdings.find((holding) => holding.ticker === "VOO")?.costBasis ?? 0) -
      13037.73 * 33.254,
  ) < 0.000001);
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

test("accepts approved active US tickers and rejects unsupported tickers or invalid numeric inputs", () => {
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

  assert.deepEqual(
    validateSharedHoldings([
      { ticker: " aapl ", ownerAccount: "Mom", entryPrice: 305.64, units: 35 },
      { ticker: "NVDA", ownerAccount: "Mom", entryPrice: 206.73, units: 45 },
      { ticker: "MU", ownerAccount: "Mom", entryPrice: 812, units: 4 },
      { ticker: "AVGO", ownerAccount: "Shared", entryPrice: 389.75, units: 6.9162 },
      { ticker: "VOO", ownerAccount: "Shared", entryPrice: 700.84, units: 18.6 },
      { ticker: "SPCX", ownerAccount: "Mom", entryPrice: 140, units: 65 },
    ]),
    [
      { ticker: "AAPL", ownerAccount: "Mom", entryPrice: 305.64, units: 35 },
      { ticker: "NVDA", ownerAccount: "Mom", entryPrice: 206.73, units: 45 },
      { ticker: "MU", ownerAccount: "Mom", entryPrice: 812, units: 4 },
      { ticker: "AVGO", ownerAccount: "Shared", entryPrice: 389.75, units: 6.9162 },
      { ticker: "VOO", ownerAccount: "Shared", entryPrice: 700.84, units: 18.6 },
      { ticker: "SPCX", ownerAccount: "Mom", entryPrice: 140, units: 65 },
    ],
  );

  assert.throws(
    () =>
      validateSharedHoldings([
        { ticker: "AMZN", ownerAccount: "Rattee", entryPrice: 200, units: 1 },
      ]),
    /row 2.*AMZN.*supported/i,
  );
  assert.throws(
    () =>
      validateSharedHoldings([
        { ticker: "SCB", ownerAccount: "Shared", entryPrice: 0, units: 10 },
      ]),
    /row 2.*entry price.*positive/i,
  );
});

test("accepts shared THB cash without adding it to the dividend forecast", () => {
  const [cash] = validateSharedHoldings([
    { ticker: "CASH", ownerAccount: "Shared", entryPrice: 2_321_088, units: 1 },
  ]);
  assert.deepEqual(cash, {
    ticker: "CASH",
    ownerAccount: "Shared",
    entryPrice: 2_321_088,
    units: 1,
  });

  const snapshot = buildDashboardSnapshotFromSharedPortfolio(
    [...holdings, cash],
    settings,
    "Shared_Portfolio.xlsx",
  );
  assert.deepEqual(snapshot.holdings.at(-1), {
    ticker: "CASH",
    account: "Shared-THB",
    owner: null,
    category: "shared",
    currency: "THB",
    quantity: 1,
    avgCostThb: 2_321_088,
    importedPriceThb: 2_321_088,
    costBasis: 2_321_088,
  });
  assert.deepEqual(
    snapshot.dividend.lines.map((line) => [line.ticker, line.eligibleQuantity]),
    [
      ["SCB", 14_999],
      ["KBANK", 630],
    ],
  );
  assert.equal(snapshot.dividend.costBasis, 2_155_932.19);
});

test("rejects cash that is assigned to a personal account", () => {
  assert.throws(
    () =>
      validateSharedHoldings([
        { ticker: "CASH", ownerAccount: "Rattee", entryPrice: 1_000, units: 1 },
      ]),
    /cash.*shared/i,
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
