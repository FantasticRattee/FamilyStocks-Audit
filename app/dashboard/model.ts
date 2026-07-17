import * as XLSX from "xlsx";

type CellValue = string | number | boolean | Date | null | undefined;
type Row = CellValue[];

export type Shareholder = {
  owner: string;
  sharedCapital: number;
  poolPercent: number;
  personalCapital: number;
  totalInvested: number;
};

export type Holding = {
  ticker: string;
  account: string;
  owner: string | null;
  category: "shared" | "personal";
  currency: "THB" | "USD";
  quantity: number;
  avgCostThb: number;
  importedPriceThb: number;
  costBasis: number;
};

export type DividendLine = {
  ticker: string;
  eligibleQuantity: number;
  dps: number;
  gross: number;
  wht: number;
  net: number;
  xdDate: string;
  note: string;
};

export type HistoricalDividend = {
  whtRate: number;
  lines: DividendLine[];
  gross: number;
  wht: number;
  net: number;
};

export type DividendForecast = {
  whtRate: number;
  lines: DividendLine[];
  basis: "current-capital" | "historical-eligibility";
  costBasis: number;
};

export type Transaction = {
  date: string;
  account: string;
  ticker: string;
  side: string;
  order: string;
  quantity: number;
  priceNative: number;
  currency: string;
  grossNative: number;
  fx: number;
  costProceedsThb: number;
  realizedPnlThb: number;
  note: string;
};

export type DashboardSnapshot = {
  filename: string;
  asOfDate: string;
  defaultFx: number;
  summary: {
    totalMarketValue: number;
    totalUnrealizedPnl: number;
    totalRealizedPnl: number;
    totalPnl: number;
    sharedCapital: number;
    sharedMarketValue: number;
    sharedUnrealizedPnl: number;
  };
  shareholders: Shareholder[];
  holdings: Holding[];
  dividend: DividendForecast;
  historicalDividend: HistoricalDividend;
  transactions: Transaction[];
};

export type Scenario = {
  fx: number;
  prices: Record<string, number>;
  dividendDps: Record<string, number>;
  whtRate: number;
};

export type CalculatedHolding = Holding & {
  priceNative: number;
  currentPriceThb: number;
  marketValue: number;
  unrealizedPnl: number;
};

export type DashboardResult = {
  holdings: CalculatedHolding[];
  totals: {
    marketValue: number;
    sharedMarketValue: number;
    personalMarketValue: number;
    unrealizedPnl: number;
    realizedPnl: number;
    totalPnl: number;
  };
  dividend: {
    gross: number;
    wht: number;
    net: number;
    referenceGross: number;
    grossYield: number;
    currentCapital: number;
    byOwner: Array<{
      owner: string;
      capital: number;
      capitalPercent: number;
      gross: number;
      wht: number;
      net: number;
    }>;
  };
};

const REQUIRED_SHEETS = [
  "Summary",
  "Shareholders",
  "Lot Holdings",
  "Dividends",
  "Holdings",
  "Transactions",
];

const text = (value: CellValue) => String(value ?? "").trim();

const normalise = (value: CellValue) =>
  text(value)
    .toLowerCase()
    .replace(/[−–—]/g, "-")
    .replace(/[^a-z0-9%]+/g, "");

const toNumber = (value: CellValue): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : undefined;
};

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

const getRows = (workbook: XLSX.WorkBook, sheetName: string): Row[] => {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Missing required worksheet: ${sheetName}`);
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: null,
  }) as Row[];
};

const findHeaderRow = (rows: Row[], requiredFragments: string[]) => {
  const required = requiredFragments.map(normalise);
  const rowIndex = rows.findIndex((row) => {
    const cells = row.map(normalise);
    const matchingColumns = required.map((fragment) =>
      cells.findIndex((cell) => cell.includes(fragment)),
    );
    return (
      matchingColumns.every((column) => column >= 0) &&
      new Set(matchingColumns).size === required.length
    );
  });
  if (rowIndex < 0) {
    throw new Error(`Could not find required header: ${requiredFragments.join(", ")}`);
  }
  return rowIndex;
};

const findColumn = (headers: string[], choices: string[][]) => {
  for (const fragments of choices) {
    const index = headers.findIndex((header) =>
      fragments.every((fragment) => header.includes(normalise(fragment))),
    );
    if (index >= 0) return index;
  }
  return -1;
};

const requiredColumn = (headers: string[], choices: string[][], label: string) => {
  const index = findColumn(headers, choices);
  if (index < 0) throw new Error(`Could not find ${label} column`);
  return index;
};

const numberRightOf = (rows: Row[], label: string) => {
  const target = normalise(label);
  for (const row of rows) {
    const labelIndex = row.findIndex((value) => normalise(value).includes(target));
    if (labelIndex < 0) continue;
    for (const value of row.slice(labelIndex + 1)) {
      const numeric = toNumber(value);
      if (numeric !== undefined) return numeric;
    }
  }
  throw new Error(`Could not find numeric value for ${label}`);
};

const numberOr = (value: CellValue, fallback = 0) => toNumber(value) ?? fallback;

const stringDate = (value: CellValue) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    // The 1899-12-30 base correctly handles modern Excel serial dates,
    // including Excel's historical 1900 leap-year compatibility bug.
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86400000));
    return date.toISOString().slice(0, 10);
  }
  const raw = text(value);
  const match = raw.match(/\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? raw;
};

const displayOwnerName = (owner: string) => {
  const key = normalise(owner);
  if (key.includes("mom")) return "Mom";
  if (key.includes("brother") || key.includes("ryu")) return "Ryu";
  if (key.includes("me") || key.includes("rattee")) return "Rattee";
  return owner;
};

const ownerForAccount = (account: string) => {
  const key = normalise(account);
  if (
    key.includes("mom") ||
    key.includes("brother") ||
    key.includes("ryu") ||
    key.includes("me") ||
    key.includes("rattee")
  ) {
    return displayOwnerName(account);
  }
  return null;
};

const parseSummary = (rows: Row[]) => ({
  totalMarketValue: numberRightOf(rows, "Total Market Value (THB)"),
  totalUnrealizedPnl: numberRightOf(rows, "Total Unrealized P&L (THB)"),
  totalRealizedPnl: numberRightOf(rows, "Total Realized P&L (THB)"),
  totalPnl: numberRightOf(rows, "Total P&L (THB)"),
  sharedCapital: numberRightOf(rows, "Shared Capital Contributed (THB)"),
  sharedMarketValue: numberRightOf(rows, "Shared Market Value (THB)"),
  sharedUnrealizedPnl: numberRightOf(rows, "Shared Unrealized P&L (THB)"),
});

const parseAsOfDate = (rows: Row[]) => {
  const title = text(rows[0]?.[0]);
  const match = title.match(/as\s+of\s+([^\)]+)/i);
  return match?.[1].trim() || "Imported workbook";
};

const parseShareholders = (rows: Row[]): Shareholder[] => {
  const headerRow = findHeaderRow(rows, [
    "Shareholder",
    "Shared Invested",
    "Total Invested",
  ]);
  const headers = rows[headerRow].map(normalise);
  const ownerColumn = requiredColumn(headers, [["shareholder"]], "Shareholder");
  const sharedColumn = requiredColumn(
    headers,
    [["shared", "invested"], ["invested"]],
    "Shared invested",
  );
  const percentColumn = headers.findIndex(
    (header) =>
      header.includes("pool") ||
      (header.includes("share") &&
        !header.includes("holder") &&
        !header.includes("shared")),
  );
  if (percentColumn < 0) throw new Error("Could not find Pool percentage column");
  const personalColumn = findColumn(headers, [["personal"]]);
  const totalColumn = findColumn(headers, [["total", "invested"]]);
  const shareholders: Shareholder[] = [];

  for (const row of rows.slice(headerRow + 1)) {
    const sourceOwner = text(row[ownerColumn]);
    const ownerKey = normalise(sourceOwner);
    if (!sourceOwner || ownerKey.includes("notes")) break;
    if (ownerKey === "total") continue;

    const sharedCapital = toNumber(row[sharedColumn]);
    const poolPercent = toNumber(row[percentColumn]);
    if (sharedCapital === undefined || poolPercent === undefined) continue;

    shareholders.push({
      owner: displayOwnerName(sourceOwner),
      sharedCapital,
      poolPercent,
      personalCapital: personalColumn >= 0 ? numberOr(row[personalColumn]) : 0,
      totalInvested:
        totalColumn >= 0 ? numberOr(row[totalColumn]) : sharedCapital,
    });
  }

  if (shareholders.length === 0) {
    throw new Error("No shareholder rows could be read from the workbook");
  }
  return shareholders;
};

const parseTransactions = (rows: Row[]): Transaction[] => {
  const headerRow = findHeaderRow(rows, ["Date", "Ticker", "Side", "Currency", "FX"]);
  const headers = rows[headerRow].map(normalise);
  const dateColumn = requiredColumn(headers, [["date"]], "Date");
  const accountColumn = requiredColumn(headers, [["account"]], "Account");
  const tickerColumn = requiredColumn(headers, [["ticker"]], "Ticker");
  const sideColumn = requiredColumn(headers, [["side"]], "Side");
  const orderColumn = findColumn(headers, [["order"]]);
  const quantityColumn = requiredColumn(headers, [["qty"], ["quantity"]], "Quantity");
  const priceColumn = requiredColumn(headers, [["price", "native"]], "Native price");
  const currencyColumn = requiredColumn(headers, [["currency"]], "Currency");
  const grossColumn = requiredColumn(headers, [["gross", "native"]], "Native gross");
  const fxColumn = requiredColumn(headers, [["fx"]], "FX");
  const costColumn = requiredColumn(headers, [["cost", "proceeds"]], "Cost/proceeds");
  const realizedColumn = requiredColumn(headers, [["realized", "p&l"]], "Realized P&L");
  const notesColumn = findColumn(headers, [["notes"]]);
  const transactions: Transaction[] = [];

  for (const row of rows.slice(headerRow + 1)) {
    if (normalise(row[dateColumn]) === "total") break;
    const ticker = text(row[tickerColumn]);
    const side = text(row[sideColumn]);
    if (!ticker || !side) continue;

    transactions.push({
      date: stringDate(row[dateColumn]),
      account: text(row[accountColumn]),
      ticker,
      side,
      order: orderColumn >= 0 ? text(row[orderColumn]) : "",
      quantity: numberOr(row[quantityColumn]),
      priceNative: numberOr(row[priceColumn]),
      currency: text(row[currencyColumn]),
      grossNative: numberOr(row[grossColumn]),
      fx: numberOr(row[fxColumn]),
      costProceedsThb: numberOr(row[costColumn]),
      realizedPnlThb: numberOr(row[realizedColumn]),
      note: notesColumn >= 0 ? text(row[notesColumn]) : "",
    });
  }

  if (transactions.length === 0) {
    throw new Error("No transactions could be read from the workbook");
  }
  return transactions;
};

const getLatestUsdFx = (transactions: Transaction[]) => {
  const usdTransactions = transactions
    .filter((transaction) => transaction.currency.toUpperCase() === "USD" && transaction.fx > 0)
    .sort((left, right) => left.date.localeCompare(right.date));
  return usdTransactions.at(-1)?.fx ?? 1;
};

const parseHoldings = (rows: Row[], defaultFx: number): Holding[] => {
  const headerRow = findHeaderRow(rows, ["Ticker", "Qty", "Avg Cost", "Cur Price"]);
  const headers = rows[headerRow].map(normalise);
  const tickerColumn = requiredColumn(headers, [["ticker"]], "Ticker");
  const accountColumn = requiredColumn(headers, [["account"]], "Account");
  const quantityColumn = requiredColumn(headers, [["qty"], ["quantity"]], "Quantity");
  const avgCostColumn = requiredColumn(headers, [["avg", "cost"]], "Average cost");
  const priceColumn = requiredColumn(headers, [["cur", "price"], ["current", "price"]], "Current price");
  const holdings: Holding[] = [];

  for (const row of rows.slice(headerRow + 1)) {
    const ticker = text(row[tickerColumn]);
    const tickerKey = normalise(ticker);
    const quantity = toNumber(row[quantityColumn]);
    if (
      !ticker ||
      quantity === undefined ||
      quantity <= 0 ||
      tickerKey.includes("total") ||
      tickerKey.includes("shared") ||
      tickerKey.includes("personal")
    ) {
      continue;
    }

    const account = text(row[accountColumn]);
    const isShared = normalise(account).includes("shared");
    const currency: Holding["currency"] = normalise(account).includes("us")
      ? "USD"
      : "THB";
    const avgCostThb = numberOr(row[avgCostColumn]);
    const importedPriceThb = numberOr(row[priceColumn]);

    holdings.push({
      ticker,
      account,
      owner: isShared ? null : ownerForAccount(account),
      category: isShared ? "shared" : "personal",
      currency,
      quantity,
      avgCostThb,
      importedPriceThb,
      costBasis: quantity * avgCostThb,
    });
  }

  if (!holdings.length) throw new Error("No active holdings could be read from the workbook");
  if (defaultFx <= 0) throw new Error("Could not determine a valid USD/THB FX rate");
  return holdings;
};

const parseHistoricalDividends = (rows: Row[]): HistoricalDividend & { whtRate: number } => {
  const headerRow = findHeaderRow(rows, ["Ticker", "Eligible", "DPS"]);
  const headers = rows[headerRow].map(normalise);
  const tickerColumn = requiredColumn(headers, [["ticker"]], "Dividend ticker");
  const eligibleColumn = requiredColumn(headers, [["eligible"]], "Eligible quantity");
  const dpsColumn = requiredColumn(headers, [["dps"]], "DPS");
  const grossColumn = findColumn(headers, [["gross"]]);
  const whtColumn = findColumn(headers, [["wht"]]);
  const netColumn = findColumn(headers, [["net"]]);
  const xdColumn = findColumn(headers, [["xd"]]);
  const noteColumn = findColumn(headers, [["note"]]);
  const lines: DividendLine[] = [];

  for (const row of rows.slice(headerRow + 1)) {
    const ticker = text(row[tickerColumn]);
    if (!ticker || normalise(ticker) === "total") break;
    if (normalise(ticker).includes("calculation")) break;
    lines.push({
      ticker,
      eligibleQuantity: numberOr(row[eligibleColumn]),
      dps: numberOr(row[dpsColumn]),
      gross: grossColumn >= 0 ? numberOr(row[grossColumn]) : 0,
      wht: whtColumn >= 0 ? numberOr(row[whtColumn]) : 0,
      net: netColumn >= 0 ? numberOr(row[netColumn]) : 0,
      xdDate: xdColumn >= 0 ? stringDate(row[xdColumn]) : "",
      note: noteColumn >= 0 ? text(row[noteColumn]) : "",
    });
  }

  if (!lines.length) throw new Error("No dividend rows could be read from the workbook");
  return {
    whtRate: numberRightOf(rows, "Withholding tax rate"),
    lines,
    gross: sum(lines.map((line) => line.gross)),
    wht: sum(lines.map((line) => line.wht)),
    net: sum(lines.map((line) => line.net)),
  };
};

const parseCurrentCapitalDividend = (
  rows: Row[],
  whtRate: number,
  costBasis: number,
): DividendForecast | undefined => {
  let headerRow: number;
  try {
    headerRow = findHeaderRow(rows, ["Ticker", "Current Qty", "DPS"]);
  } catch {
    return undefined;
  }

  const headers = rows[headerRow].map(normalise);
  const tickerColumn = requiredColumn(headers, [["ticker"]], "Forecast ticker");
  const quantityColumn = requiredColumn(
    headers,
    [["current", "qty"], ["qty"]],
    "Forecast quantity",
  );
  const dpsColumn = requiredColumn(headers, [["dps"]], "Forecast DPS");
  const treatmentColumn = findColumn(headers, [["treatment"], ["note"]]);
  const lines: DividendLine[] = [];

  for (const row of rows.slice(headerRow + 1)) {
    const ticker = text(row[tickerColumn]);
    const tickerKey = normalise(ticker);
    if (!ticker || tickerKey.includes("currentholdingsreference")) break;
    const eligibleQuantity = toNumber(row[quantityColumn]);
    const dps = toNumber(row[dpsColumn]);
    if (eligibleQuantity === undefined || dps === undefined) continue;
    const gross = eligibleQuantity * dps;
    lines.push({
      ticker,
      eligibleQuantity,
      dps,
      gross,
      wht: gross * whtRate,
      net: gross * (1 - whtRate),
      xdDate: "",
      note: treatmentColumn >= 0 ? text(row[treatmentColumn]) : "",
    });
  }

  if (!lines.length || costBasis <= 0) return undefined;
  return {
    whtRate,
    lines,
    basis: "current-capital",
    costBasis,
  };
};

export function parseWorkbook(input: ArrayBuffer, filename: string): DashboardSnapshot {
  let workbook: XLSX.WorkBook;
  try {
    // Excel stores dates as serial numbers. Keeping those raw avoids a browser
    // timezone converting a Thai trade date to the prior calendar day.
    workbook = XLSX.read(input, { type: "array", cellDates: false });
  } catch {
    throw new Error("Unable to read this file as an XLSX workbook");
  }

  const missingSheets = REQUIRED_SHEETS.filter(
    (sheetName) => !workbook.SheetNames.includes(sheetName),
  );
  if (missingSheets.length) {
    throw new Error(`Missing required audit sheet(s): ${missingSheets.join(", ")}`);
  }

  try {
    const summaryRows = getRows(workbook, "Summary");
    const shareholderRows = getRows(workbook, "Shareholders");
    const transactionRows = getRows(workbook, "Transactions");
    const transactions = parseTransactions(transactionRows);
    const defaultFx = getLatestUsdFx(transactions);
    const holdings = parseHoldings(getRows(workbook, "Holdings"), defaultFx);
    const dividendRows = getRows(workbook, "Dividends");
    const historicalDividend = parseHistoricalDividends(dividendRows);
    const sharedCostBasis = sum(
      holdings
        .filter((holding) => holding.category === "shared")
        .map((holding) => holding.costBasis),
    );
    const dividend =
      parseCurrentCapitalDividend(
        dividendRows,
        historicalDividend.whtRate,
        sharedCostBasis,
      ) ?? {
        whtRate: historicalDividend.whtRate,
        lines: historicalDividend.lines,
        basis: "historical-eligibility" as const,
        costBasis: sharedCostBasis,
      };

    return {
      filename,
      asOfDate: parseAsOfDate(summaryRows),
      defaultFx,
      summary: parseSummary(summaryRows),
      shareholders: parseShareholders(shareholderRows),
      holdings,
      dividend,
      historicalDividend,
      transactions,
    };
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("Unable to extract the required audit data from this workbook");
  }
}

export function createScenario(snapshot: DashboardSnapshot): Scenario {
  const prices = Object.fromEntries(
    snapshot.holdings.map((holding) => [
      holding.ticker,
      holding.currency === "USD"
        ? holding.importedPriceThb / snapshot.defaultFx
        : holding.importedPriceThb,
    ]),
  );
  const dividendDps = Object.fromEntries(
    snapshot.dividend.lines.map((line) => [line.ticker, line.dps]),
  );
  return {
    fx: snapshot.defaultFx,
    prices,
    dividendDps,
    whtRate: snapshot.dividend.whtRate,
  };
}

export function calculateDashboard(
  snapshot: DashboardSnapshot,
  scenario: Scenario,
): DashboardResult {
  const holdings = snapshot.holdings.map<CalculatedHolding>((holding) => {
    const importedNativePrice =
      holding.currency === "USD"
        ? holding.importedPriceThb / snapshot.defaultFx
        : holding.importedPriceThb;
    const priceNative = scenario.prices[holding.ticker] ?? importedNativePrice;
    const currentPriceThb =
      holding.currency === "USD" ? priceNative * scenario.fx : priceNative;
    const marketValue = holding.quantity * currentPriceThb;

    return {
      ...holding,
      priceNative,
      currentPriceThb,
      marketValue,
      unrealizedPnl: marketValue - holding.costBasis,
    };
  });

  const sharedHoldings = holdings.filter((holding) => holding.category === "shared");
  const personalHoldings = holdings.filter((holding) => holding.category === "personal");
  const sharedMarketValue = sum(sharedHoldings.map((holding) => holding.marketValue));
  const personalMarketValue = sum(personalHoldings.map((holding) => holding.marketValue));
  const marketValue = sharedMarketValue + personalMarketValue;
  const unrealizedPnl = sum(holdings.map((holding) => holding.unrealizedPnl));
  const realizedPnl = snapshot.summary.totalRealizedPnl;
  const dividendReferenceGross = sum(
    snapshot.dividend.lines.map(
      (line) => line.eligibleQuantity * (scenario.dividendDps[line.ticker] ?? line.dps),
    ),
  );
  const dividendGrossYield =
    snapshot.dividend.costBasis > 0
      ? dividendReferenceGross / snapshot.dividend.costBasis
      : 0;
  const dividendCurrentCapital = sum(
    snapshot.shareholders.map((shareholder) => shareholder.sharedCapital),
  );
  const usesCurrentCapital = snapshot.dividend.basis === "current-capital";
  const dividendGross = usesCurrentCapital
    ? dividendCurrentCapital * dividendGrossYield
    : dividendReferenceGross;
  const dividendWht = dividendGross * scenario.whtRate;
  const dividendNet = dividendGross - dividendWht;

  return {
    holdings,
    totals: {
      marketValue,
      sharedMarketValue,
      personalMarketValue,
      unrealizedPnl,
      realizedPnl,
      totalPnl: unrealizedPnl + realizedPnl,
    },
    dividend: {
      gross: dividendGross,
      wht: dividendWht,
      net: dividendNet,
      referenceGross: dividendReferenceGross,
      grossYield: dividendGrossYield,
      currentCapital: dividendCurrentCapital,
      byOwner: snapshot.shareholders.map((shareholder) => {
        const capitalPercent =
          usesCurrentCapital && dividendCurrentCapital > 0
            ? shareholder.sharedCapital / dividendCurrentCapital
            : shareholder.poolPercent;
        const gross = dividendGross * capitalPercent;
        const wht = gross * scenario.whtRate;
        return {
          owner: shareholder.owner,
          capital: shareholder.sharedCapital,
          capitalPercent,
          gross,
          wht,
          net: gross - wht,
        };
      }),
    },
  };
}
