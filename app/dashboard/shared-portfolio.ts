import * as XLSX from "xlsx";

import type {
  DashboardSnapshot,
  HistoricalDividend,
  Shareholder,
  Transaction,
} from "./model";

export const MINIMAL_HOLDINGS_HEADERS = [
  "Ticker",
  "Owner/Account",
  "Entry Price",
  "Units",
] as const;

export const SUPPORTED_HOLDING_TICKERS = {
  GOOGL: { currency: "USD", marketKey: "GOOGL" },
  SCB: { currency: "THB", marketKey: "SCB" },
  KBANK: { currency: "THB", marketKey: "KBANK" },
} as const;

export type SupportedHoldingTicker = keyof typeof SUPPORTED_HOLDING_TICKERS;

export type SharedHoldingInput = {
  ticker: SupportedHoldingTicker;
  ownerAccount: "Shared" | "Mom" | "Rattee" | "Ryu";
  entryPrice: number;
  units: number;
};

export type PortfolioSettings = {
  schemaVersion: 1;
  asOfDate: string;
  defaultFx: number;
  totalRealizedPnl: number;
  shareholders: Shareholder[];
  dividend: {
    whtRate: number;
    lines: Array<{
      ticker: string;
      dps: number;
      note: string;
    }>;
  };
  historicalDividend: HistoricalDividend;
  transactions: Transaction[];
};

export type MinimalHoldingsParseResult = {
  filename: string;
  holdings: SharedHoldingInput[];
};

export type MinimalHoldingsExportResult = {
  bytes: ArrayBuffer;
  filename: string;
};

const text = (value: unknown) => String(value ?? "").trim();

const normalizedHeader = (value: unknown) =>
  text(value).toLowerCase().replace(/\s+/g, " ");

const positiveFinite = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const normalizeOwnerAccount = (
  value: unknown,
): SharedHoldingInput["ownerAccount"] | null => {
  const normalized = text(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (normalized.startsWith("shared")) return "Shared";
  if (normalized.includes("mom")) return "Mom";
  if (normalized.includes("brother") || normalized.includes("ryu")) return "Ryu";
  if (
    normalized === "me" ||
    normalized.includes("rattee") ||
    normalized.includes("personalusme")
  ) {
    return "Rattee";
  }
  return null;
};

const normalizeTicker = (value: unknown): SupportedHoldingTicker | null => {
  const ticker = text(value).toUpperCase();
  return ticker in SUPPORTED_HOLDING_TICKERS
    ? (ticker as SupportedHoldingTicker)
    : null;
};

const numericValue = (value: unknown) => {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return Number.NaN;
  return Number(value.replaceAll(",", "").trim());
};

export function validateSharedHoldings(input: unknown): SharedHoldingInput[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("Holdings must contain at least one row.");
  }

  return input.map((raw, index) => {
    const rowNumber = index + 2;
    if (!raw || typeof raw !== "object") {
      throw new Error(`Row ${rowNumber}: holding row is invalid.`);
    }
    const row = raw as Record<string, unknown>;
    const rawTicker = text(row.ticker);
    const ticker = normalizeTicker(rawTicker);
    if (!ticker) {
      throw new Error(
        `Row ${rowNumber}: ${rawTicker || "Ticker"} is not a supported ticker. Supported tickers are GOOGL, SCB, and KBANK.`,
      );
    }

    const ownerAccount = normalizeOwnerAccount(row.ownerAccount);
    if (!ownerAccount) {
      throw new Error(
        `Row ${rowNumber}: Owner/Account must be Shared, Mom, Rattee, or Ryu.`,
      );
    }

    const entryPrice = numericValue(row.entryPrice);
    if (!positiveFinite(entryPrice)) {
      throw new Error(`Row ${rowNumber}: Entry Price must be a positive number.`);
    }
    const units = numericValue(row.units);
    if (!positiveFinite(units)) {
      throw new Error(`Row ${rowNumber}: Units must be a positive number.`);
    }

    return { ticker, ownerAccount, entryPrice, units };
  });
}

export function parseMinimalHoldingsWorkbook(
  input: ArrayBuffer,
  filename: string,
): MinimalHoldingsParseResult {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(input, { type: "array", cellDates: false });
  } catch {
    throw new Error("Unable to read this file as an XLSX workbook.");
  }

  if (workbook.SheetNames.length !== 1 || workbook.SheetNames[0] !== "Holdings") {
    throw new Error('The minimal workbook must contain exactly one sheet named "Holdings".');
  }

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Holdings, {
    header: 1,
    raw: true,
    defval: null,
  }) as unknown[][];
  const header = rows[0] ?? [];
  const populatedHeader = header.filter((value) => text(value).length > 0);
  const expected = MINIMAL_HOLDINGS_HEADERS.map(normalizedHeader);
  const actual = populatedHeader.map(normalizedHeader);
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error(
      `Holdings header must contain exactly: ${MINIMAL_HOLDINGS_HEADERS.join(", ")}.`,
    );
  }

  const holdings = validateSharedHoldings(
    rows.slice(1)
      .filter((row) => row.some((value) => text(value).length > 0))
      .map((row) => ({
        ticker: row[0],
        ownerAccount: row[1],
        entryPrice: row[2],
        units: row[3],
      })),
  );
  return { filename, holdings };
}

const asArrayBuffer = (value: unknown): ArrayBuffer => {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return view.buffer.slice(
      view.byteOffset,
      view.byteOffset + view.byteLength,
    ) as ArrayBuffer;
  }
  throw new Error("Unable to export the workbook.");
};

export function exportMinimalHoldingsWorkbook(
  input: SharedHoldingInput[],
  options: { exportedAt?: string } = {},
): MinimalHoldingsExportResult {
  const holdings = validateSharedHoldings(input);
  const exportedAt = options.exportedAt ?? new Date().toISOString();
  const exportDate = exportedAt.slice(0, 10);
  const rows = [
    [...MINIMAL_HOLDINGS_HEADERS],
    ...holdings.map((holding) => [
      holding.ticker,
      holding.ownerAccount,
      holding.entryPrice,
      holding.units,
    ]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [
    { wch: 13 },
    { wch: 20 },
    { wch: 16 },
    { wch: 14 },
  ];
  sheet["!autofilter"] = { ref: `A1:D${rows.length}` };
  for (let row = 1; row < rows.length; row += 1) {
    const entryPrice = sheet[`C${row + 1}`];
    const units = sheet[`D${row + 1}`];
    if (entryPrice) entryPrice.z = "#,##0.00####";
    if (units) units.z = "#,##0.####";
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Holdings");
  return {
    bytes: asArrayBuffer(XLSX.write(workbook, { type: "array", bookType: "xlsx" })),
    filename: `Portfolio_Holdings_${exportDate}.xlsx`,
  };
}

export function buildDashboardSnapshotFromSharedPortfolio(
  input: SharedHoldingInput[],
  settings: PortfolioSettings,
  filename: string,
): DashboardSnapshot {
  const holdings = validateSharedHoldings(input).map((holding) => {
    const tickerConfig = SUPPORTED_HOLDING_TICKERS[holding.ticker];
    const category = holding.ownerAccount === "Shared" ? "shared" : "personal";
    const avgCostThb =
      tickerConfig.currency === "USD"
        ? holding.entryPrice * settings.defaultFx
        : holding.entryPrice;
    return {
      ticker: holding.ticker,
      account:
        category === "shared"
          ? `Shared-${tickerConfig.currency}`
          : `Personal-${tickerConfig.currency} (${holding.ownerAccount})`,
      owner: category === "shared" ? null : holding.ownerAccount,
      category,
      currency: tickerConfig.currency,
      quantity: holding.units,
      avgCostThb,
      importedPriceThb: avgCostThb,
      costBasis: holding.units * avgCostThb,
    } as const;
  });

  const sharedHoldings = holdings.filter((holding) => holding.category === "shared");
  const sharedCostBasis = sharedHoldings.reduce(
    (total, holding) => total + holding.costBasis,
    0,
  );
  const totalCostBasis = holdings.reduce(
    (total, holding) => total + holding.costBasis,
    0,
  );
  const sharedCapital = settings.shareholders.reduce(
    (total, shareholder) => total + shareholder.sharedCapital,
    0,
  );
  const dividendLines = settings.dividend.lines.map((line) => {
    const eligibleQuantity = sharedHoldings
      .filter((holding) => holding.ticker === line.ticker)
      .reduce((total, holding) => total + holding.quantity, 0);
    const gross = eligibleQuantity * line.dps;
    return {
      ticker: line.ticker,
      eligibleQuantity,
      dps: line.dps,
      gross,
      wht: gross * settings.dividend.whtRate,
      net: gross * (1 - settings.dividend.whtRate),
      xdDate: "",
      note: line.note,
    };
  });

  return {
    filename,
    asOfDate: settings.asOfDate,
    defaultFx: settings.defaultFx,
    summary: {
      totalMarketValue: totalCostBasis,
      totalUnrealizedPnl: 0,
      totalRealizedPnl: settings.totalRealizedPnl,
      totalPnl: settings.totalRealizedPnl,
      sharedCapital,
      sharedMarketValue: sharedCostBasis,
      sharedUnrealizedPnl: 0,
    },
    shareholders: settings.shareholders,
    holdings,
    dividend: {
      whtRate: settings.dividend.whtRate,
      lines: dividendLines,
      basis: "current-capital",
      costBasis: sharedCostBasis,
    },
    historicalDividend: settings.historicalDividend,
    transactions: settings.transactions,
  };
}
