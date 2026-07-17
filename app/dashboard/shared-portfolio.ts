import * as XLSX from "xlsx";

import {
  parseWorkbook,
  type DashboardSnapshot,
  type HistoricalDividend,
  type Shareholder,
  type Transaction,
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

export const CANONICAL_AUDIT_SHEET_NAMES = [
  "Summary",
  "Shareholders",
  "Lot Holdings",
  "Dividends",
  "Holdings",
  "Transactions",
] as const;

export type WorkbookImportParseResult = {
  filename: string;
  holdings: SharedHoldingInput[];
  source: "minimal" | "audit";
  settings?: PortfolioSettings;
};

export type MinimalHoldingsParseResult = WorkbookImportParseResult;

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

const asRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value as Record<string, unknown>;
};

const finiteNumber = (value: unknown, label: string) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
};

const nonNegativeNumber = (value: unknown, label: string) => {
  const number = finiteNumber(value, label);
  if (number < 0) throw new Error(`${label} cannot be negative.`);
  return number;
};

const requiredText = (value: unknown, label: string) => {
  const result = text(value);
  if (!result) throw new Error(`${label} is required.`);
  return result;
};

const validateDividendLine = (value: unknown, label: string) => {
  const line = asRecord(value, label);
  return {
    ticker: requiredText(line.ticker, `${label}.ticker`),
    eligibleQuantity: nonNegativeNumber(
      line.eligibleQuantity,
      `${label}.eligibleQuantity`,
    ),
    dps: nonNegativeNumber(line.dps, `${label}.dps`),
    gross: nonNegativeNumber(line.gross, `${label}.gross`),
    wht: nonNegativeNumber(line.wht, `${label}.wht`),
    net: nonNegativeNumber(line.net, `${label}.net`),
    xdDate: text(line.xdDate),
    note: text(line.note),
  };
};

export function validatePortfolioSettings(input: unknown): PortfolioSettings {
  const settings = asRecord(input, "Audit settings");
  if (settings.schemaVersion !== 1) {
    throw new Error("Audit settings schemaVersion must be 1.");
  }
  const defaultFx = finiteNumber(settings.defaultFx, "Audit settings defaultFx");
  if (defaultFx <= 0) {
    throw new Error("Audit settings defaultFx must be positive.");
  }
  if (!Array.isArray(settings.shareholders)) {
    throw new Error("Audit settings shareholders must be an array.");
  }
  const dividend = asRecord(settings.dividend, "Audit settings dividend");
  const whtRate = finiteNumber(dividend.whtRate, "Audit settings dividend.whtRate");
  if (whtRate < 0 || whtRate > 1) {
    throw new Error("Audit settings dividend.whtRate must be between 0 and 1.");
  }
  if (!Array.isArray(dividend.lines)) {
    throw new Error("Audit settings dividend.lines must be an array.");
  }
  const historical = asRecord(
    settings.historicalDividend,
    "Audit settings historicalDividend",
  );
  if (!Array.isArray(historical.lines)) {
    throw new Error("Audit settings historicalDividend.lines must be an array.");
  }
  const historicalWhtRate = finiteNumber(
    historical.whtRate,
    "Audit settings historicalDividend.whtRate",
  );
  if (historicalWhtRate < 0 || historicalWhtRate > 1) {
    throw new Error("Audit settings historicalDividend.whtRate must be between 0 and 1.");
  }
  if (!Array.isArray(settings.transactions)) {
    throw new Error("Audit settings transactions must be an array.");
  }

  return {
    schemaVersion: 1,
    asOfDate: requiredText(settings.asOfDate, "Audit settings asOfDate"),
    defaultFx,
    totalRealizedPnl: finiteNumber(
      settings.totalRealizedPnl,
      "Audit settings totalRealizedPnl",
    ),
    shareholders: settings.shareholders.map((value, index) => {
      const shareholder = asRecord(value, `Audit settings shareholders[${index}]`);
      return {
        owner: requiredText(shareholder.owner, `Audit settings shareholders[${index}].owner`),
        sharedCapital: nonNegativeNumber(
          shareholder.sharedCapital,
          `Audit settings shareholders[${index}].sharedCapital`,
        ),
        poolPercent: nonNegativeNumber(
          shareholder.poolPercent,
          `Audit settings shareholders[${index}].poolPercent`,
        ),
        personalCapital: nonNegativeNumber(
          shareholder.personalCapital,
          `Audit settings shareholders[${index}].personalCapital`,
        ),
        totalInvested: nonNegativeNumber(
          shareholder.totalInvested,
          `Audit settings shareholders[${index}].totalInvested`,
        ),
      };
    }),
    dividend: {
      whtRate,
      lines: dividend.lines.map((value, index) => {
        const line = asRecord(value, `Audit settings dividend.lines[${index}]`);
        return {
          ticker: requiredText(line.ticker, `Audit settings dividend.lines[${index}].ticker`),
          dps: nonNegativeNumber(line.dps, `Audit settings dividend.lines[${index}].dps`),
          note: text(line.note),
        };
      }),
    },
    historicalDividend: {
      whtRate: historicalWhtRate,
      lines: historical.lines.map((value, index) =>
        validateDividendLine(value, `Audit settings historicalDividend.lines[${index}]`),
      ),
      gross: nonNegativeNumber(historical.gross, "Audit settings historicalDividend.gross"),
      wht: nonNegativeNumber(historical.wht, "Audit settings historicalDividend.wht"),
      net: nonNegativeNumber(historical.net, "Audit settings historicalDividend.net"),
    },
    transactions: settings.transactions.map((value, index) => {
      const transaction = asRecord(value, `Audit settings transactions[${index}]`);
      return {
        date: requiredText(transaction.date, `Audit settings transactions[${index}].date`),
        account: requiredText(transaction.account, `Audit settings transactions[${index}].account`),
        ticker: requiredText(transaction.ticker, `Audit settings transactions[${index}].ticker`),
        side: requiredText(transaction.side, `Audit settings transactions[${index}].side`),
        order: text(transaction.order),
        quantity: nonNegativeNumber(transaction.quantity, `Audit settings transactions[${index}].quantity`),
        priceNative: nonNegativeNumber(transaction.priceNative, `Audit settings transactions[${index}].priceNative`),
        currency: requiredText(transaction.currency, `Audit settings transactions[${index}].currency`),
        grossNative: nonNegativeNumber(transaction.grossNative, `Audit settings transactions[${index}].grossNative`),
        fx: nonNegativeNumber(transaction.fx, `Audit settings transactions[${index}].fx`),
        costProceedsThb: finiteNumber(transaction.costProceedsThb, `Audit settings transactions[${index}].costProceedsThb`),
        realizedPnlThb: finiteNumber(transaction.realizedPnlThb, `Audit settings transactions[${index}].realizedPnlThb`),
        note: text(transaction.note),
      };
    }),
  };
}

const snapshotToPortfolioSettings = (
  snapshot: DashboardSnapshot,
): PortfolioSettings => ({
  schemaVersion: 1,
  asOfDate: snapshot.asOfDate,
  defaultFx: snapshot.defaultFx,
  totalRealizedPnl: snapshot.summary.totalRealizedPnl,
  shareholders: snapshot.shareholders,
  dividend: {
    whtRate: snapshot.dividend.whtRate,
    lines: snapshot.dividend.lines.map((line) => ({
      ticker: line.ticker,
      dps: line.dps,
      note: line.note,
    })),
  },
  historicalDividend: snapshot.historicalDividend,
  transactions: snapshot.transactions,
});

const snapshotToSharedHoldings = (snapshot: DashboardSnapshot) =>
  validateSharedHoldings(
    snapshot.holdings.map((holding) => ({
      ticker: holding.ticker,
      ownerAccount: holding.category === "shared" ? "Shared" : holding.owner,
      entryPrice:
        holding.currency === "USD"
          ? holding.avgCostThb / snapshot.defaultFx
          : holding.avgCostThb,
      units: holding.quantity,
    })),
  );

const parseMinimalHoldingsRows = (
  workbook: XLSX.WorkBook,
  filename: string,
): WorkbookImportParseResult => {
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
  return { filename, holdings, source: "minimal" };
};

export function parseWorkbookForImport(
  input: ArrayBuffer,
  filename: string,
): WorkbookImportParseResult {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(input, { type: "array", cellDates: false });
  } catch {
    throw new Error("Unable to read this file as an XLSX workbook.");
  }

  if (workbook.SheetNames.length === 1 && workbook.SheetNames[0] === "Holdings") {
    return parseMinimalHoldingsRows(workbook, filename);
  }

  const isCanonicalAudit = CANONICAL_AUDIT_SHEET_NAMES.every((name) =>
    workbook.SheetNames.includes(name),
  );
  if (!isCanonicalAudit) {
    throw new Error(
      "Choose either the canonical six-sheet Portfolio_Accounting.xlsx or a one-sheet Holdings workbook with Ticker, Owner/Account, Entry Price, Units.",
    );
  }

  const snapshot = parseWorkbook(input, filename);
  return {
    filename,
    holdings: snapshotToSharedHoldings(snapshot),
    settings: snapshotToPortfolioSettings(snapshot),
    source: "audit",
  };
}

// Retained as a compatibility export for callers that used the former name.
export const parseMinimalHoldingsWorkbook = parseWorkbookForImport;

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
