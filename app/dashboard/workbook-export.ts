import * as XLSX from "xlsx";

export type HoldingCurrency = "THB" | "USD";

export type ExportHolding = {
  ticker: string;
  currency: HoldingCurrency;
};

export type TickerRename = {
  from: string;
  to: string;
};

export type PriceUpdate = {
  ticker: string;
  priceNative: number;
  currency: HoldingCurrency;
  fx: number;
  source: "Yahoo Finance" | "Manual";
  yahooSymbol?: string;
  companyName?: string;
  quoteTimestamp?: string;
};

export type DividendUpdate = {
  ticker: string;
  dps: number;
};

export type WorkbookEditRequest = {
  sourceWorkbook: string;
  exportedAt: string;
  holdings: ExportHolding[];
  renames: TickerRename[];
  priceUpdates: PriceUpdate[];
  dividendUpdates: DividendUpdate[];
  whtRate?: number;
};

export type WorkbookEditResult = {
  bytes: ArrayBuffer;
  filename: string;
  auditRows: unknown[][];
};

const tickerPattern = /^[A-Za-z0-9.^=-]{1,32}$/;

const normalise = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[−–—]/g, "-")
    .replace(/[^a-z0-9%]+/g, "");

const text = (value: unknown) => String(value ?? "").trim();

const isFinitePositive = (value: number) => Number.isFinite(value) && value > 0;
const isFiniteNonNegative = (value: number) => Number.isFinite(value) && value >= 0;

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const asArrayBuffer = (value: unknown) => value as ArrayBuffer;

function getTickerMap(renames: TickerRename[]) {
  return Object.fromEntries(renames.map((rename) => [rename.from, rename.to]));
}

function validateRequest(request: WorkbookEditRequest) {
  if (
    !request.renames.length &&
    !request.priceUpdates.length &&
    !request.dividendUpdates.length &&
    request.whtRate === undefined
  ) {
    throw new Error("No editable changes are available to export");
  }

  const sourceTickers = new Set(request.holdings.map((holding) => holding.ticker));
  const renameSources = new Set<string>();
  const renameTargets = new Set<string>();

  for (const rename of request.renames) {
    if (!sourceTickers.has(rename.from)) {
      throw new Error(`Ticker ${rename.from} is not an active holding`);
    }
    if (!tickerPattern.test(rename.to)) {
      throw new Error(`Ticker ${rename.to} contains unsupported characters`);
    }
    if (rename.from === rename.to) {
      throw new Error(`Ticker ${rename.from} cannot be renamed to itself`);
    }
    if (renameSources.has(rename.from) || renameTargets.has(rename.to)) {
      throw new Error("Each ticker rename must have one unique source and target");
    }
    renameSources.add(rename.from);
    renameTargets.add(rename.to);
  }

  const tickerMap = getTickerMap(request.renames);
  const resolvedTickers = request.holdings.map(
    (holding) => tickerMap[holding.ticker] ?? holding.ticker,
  );
  if (new Set(resolvedTickers).size !== resolvedTickers.length) {
    throw new Error("The ticker rename would create a duplicate active holding");
  }

  const holdingsByTicker = new Map(
    request.holdings.map((holding) => [holding.ticker, holding]),
  );
  const priceTickers = new Set<string>();
  for (const price of request.priceUpdates) {
    const holding = holdingsByTicker.get(price.ticker);
    if (!holding) throw new Error(`Ticker ${price.ticker} is not an active holding`);
    if (priceTickers.has(price.ticker)) {
      throw new Error(`Ticker ${price.ticker} has more than one price update`);
    }
    if (price.currency !== holding.currency) {
      throw new Error(`Quote currency does not match the ${price.ticker} account currency`);
    }
    if (!isFinitePositive(price.priceNative)) {
      throw new Error(`Ticker ${price.ticker} needs a positive current price`);
    }
    if (!isFinitePositive(price.fx)) {
      throw new Error(`Ticker ${price.ticker} needs a positive USD/THB FX rate`);
    }
    priceTickers.add(price.ticker);
  }

  const dividendTickers = new Set<string>();
  for (const dividend of request.dividendUpdates) {
    if (!dividend.ticker || !isFiniteNonNegative(dividend.dps)) {
      throw new Error("Each dividend update needs a ticker and a non-negative DPS");
    }
    if (dividendTickers.has(dividend.ticker)) {
      throw new Error(`Ticker ${dividend.ticker} has more than one dividend update`);
    }
    dividendTickers.add(dividend.ticker);
  }
  if (
    request.whtRate !== undefined &&
    (!Number.isFinite(request.whtRate) || request.whtRate < 0 || request.whtRate > 1)
  ) {
    throw new Error("Withholding tax must be between 0% and 100%");
  }
}

function replaceFormulaTickerCriteria(formula: string, tickerMap: Record<string, string>) {
  return formula.replace(/"((?:[^"]|"")*)"/g, (match, encoded: string) => {
    const value = encoded.replaceAll('""', '"');
    const replacement = tickerMap[value];
    return replacement ? `"${replacement.replaceAll('"', '""')}"` : match;
  });
}

function replaceTickerDisplayToken(value: string, tickerMap: Record<string, string>) {
  if (tickerMap[value]) return tickerMap[value];

  return Object.entries(tickerMap).reduce((nextValue, [from, to]) => {
    const escaped = escapeRegex(from);
    const leadingTicker = new RegExp(`(^|\\s)${escaped}(?=\\s*\\()`, "g");
    const parenthesisedTicker = new RegExp(`\\(${escaped}\\)`, "g");
    return nextValue
      .replace(leadingTicker, (_match, prefix: string) => `${prefix}${to}`)
      .replace(parenthesisedTicker, `(${to})`);
  }, value);
}

function writeNumber(ws: XLSX.WorkSheet, row: number, column: number, value: number) {
  const address = XLSX.utils.encode_cell({ r: row, c: column });
  const cell = ws[address] ?? { t: "n" as const };
  cell.t = "n";
  cell.v = value;
  delete cell.f;
  delete cell.w;
  ws[address] = cell;
}

function findColumn(headers: unknown[], required: string[]) {
  const normalisedHeaders = headers.map(normalise);
  return normalisedHeaders.findIndex((header) =>
    required.every((fragment) => header.includes(normalise(fragment))),
  );
}

function applyPriceUpdates(workbook: XLSX.WorkBook, priceUpdates: PriceUpdate[]) {
  if (!priceUpdates.length) return;
  const sheet = workbook.Sheets.Holdings;
  if (!sheet) throw new Error("Missing Holdings worksheet");

  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: null,
  }) as unknown[][];
  const headerRow = rows.findIndex((row) => {
    const tickerColumn = findColumn(row, ["Ticker"]);
    const priceColumn = findColumn(row, ["Cur", "Price"]);
    return tickerColumn >= 0 && priceColumn >= 0;
  });
  if (headerRow < 0) throw new Error("Could not find Holdings ticker and current-price columns");

  const tickerColumn = findColumn(rows[headerRow], ["Ticker"]);
  const priceColumn = findColumn(rows[headerRow], ["Cur", "Price"]);
  const updates = new Map(priceUpdates.map((update) => [update.ticker, update]));
  const found = new Set<string>();

  for (let row = headerRow + 1; row < rows.length; row += 1) {
    const ticker = text(rows[row][tickerColumn]);
    const update = updates.get(ticker);
    if (!update) continue;
    const priceThb =
      update.currency === "USD" ? update.priceNative * update.fx : update.priceNative;
    writeNumber(sheet, row, priceColumn, priceThb);
    found.add(ticker);
  }

  const missing = priceUpdates.find((update) => !found.has(update.ticker));
  if (missing) {
    throw new Error(`Could not find ${missing.ticker} in the Holdings worksheet`);
  }
}

function applyDividendUpdates(
  workbook: XLSX.WorkBook,
  dividendUpdates: DividendUpdate[],
  whtRate: number | undefined,
) {
  if (!dividendUpdates.length && whtRate === undefined) return;
  const sheet = workbook.Sheets.Dividends;
  if (!sheet) throw new Error("Missing Dividends worksheet");

  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: null,
  }) as unknown[][];

  if (dividendUpdates.length) {
    const forecastHeaderRow = rows.findIndex((row) => {
      const tickerColumn = findColumn(row, ["Ticker"]);
      const quantityColumn = findColumn(row, ["Current", "Qty"]);
      const dpsColumn = findColumn(row, ["FY2025", "DPS"]);
      return tickerColumn >= 0 && quantityColumn >= 0 && dpsColumn >= 0;
    });
    const headerRow =
      forecastHeaderRow >= 0
        ? forecastHeaderRow
        : rows.findIndex((row) => {
            const tickerColumn = findColumn(row, ["Ticker"]);
            const dpsColumn = findColumn(row, ["DPS"]);
            return tickerColumn >= 0 && dpsColumn >= 0;
          });
    if (headerRow < 0) throw new Error("Could not find Dividends ticker and DPS columns");

    const tickerColumn = findColumn(rows[headerRow], ["Ticker"]);
    const dpsColumn = findColumn(
      rows[headerRow],
      forecastHeaderRow >= 0 ? ["FY2025", "DPS"] : ["DPS"],
    );
    const updates = new Map(dividendUpdates.map((update) => [update.ticker, update]));
    const found = new Set<string>();
    for (let row = headerRow + 1; row < rows.length; row += 1) {
      const ticker = text(rows[row][tickerColumn]);
      const update = updates.get(ticker);
      if (!update) continue;
      writeNumber(sheet, row, dpsColumn, update.dps);
      found.add(ticker);
    }
    const missing = dividendUpdates.find((update) => !found.has(update.ticker));
    if (missing) throw new Error(`Could not find ${missing.ticker} in the Dividends worksheet`);
  }

  if (whtRate !== undefined) {
    let whtCell: { row: number; column: number } | undefined;
    for (let row = 0; row < rows.length && !whtCell; row += 1) {
      const labelColumn = rows[row].findIndex((value) =>
        normalise(value).includes("withholdingtaxrate"),
      );
      if (labelColumn < 0) continue;
      const numericColumn = rows[row].findIndex(
        (value, column) => column > labelColumn && typeof value === "number",
      );
      if (numericColumn >= 0) whtCell = { row, column: numericColumn };
    }
    if (!whtCell) throw new Error("Could not find the Dividends withholding-tax input");
    writeNumber(sheet, whtCell.row, whtCell.column, whtRate);
  }
}

function applyTickerRenames(workbook: XLSX.WorkBook, tickerMap: Record<string, string>) {
  if (Object.keys(tickerMap).length === 0) return;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    for (const [address, cell] of Object.entries(sheet)) {
      if (address.startsWith("!") || !cell || typeof cell !== "object") continue;
      if (typeof cell.f === "string") {
        cell.f = replaceFormulaTickerCriteria(cell.f, tickerMap);
      }
      if (typeof cell.v === "string") {
        const nextValue = replaceTickerDisplayToken(cell.v, tickerMap);
        if (nextValue !== cell.v) {
          cell.v = nextValue;
          cell.t = "s";
          delete cell.w;
        }
      }
    }
  }
}

function upsertAuditSheet(
  workbook: XLSX.WorkBook,
  request: WorkbookEditRequest,
  tickerMap: Record<string, string>,
) {
  const auditHeader = [
    "Exported at",
    "Source workbook",
    "Old ticker",
    "New ticker",
    "Yahoo company / symbol",
    "Quote price / currency",
    "FX used",
    "THB price written",
    "Source",
    "Quote timestamp",
  ];
  const priceByTicker = new Map(
    request.priceUpdates.map((price) => [price.ticker, price]),
  );
  const changedTickers = Array.from(
    new Set([...request.renames.map((rename) => rename.from), ...priceByTicker.keys()]),
  );
  const auditRows = changedTickers.map((ticker) => {
    const price = priceByTicker.get(ticker);
    const priceThb = price
      ? price.currency === "USD"
        ? price.priceNative * price.fx
        : price.priceNative
      : "";
    const yahooIdentity = price
      ? [price.companyName, price.yahooSymbol].filter(Boolean).join(" / ")
      : "";
    return [
      request.exportedAt,
      request.sourceWorkbook,
      ticker,
      tickerMap[ticker] ?? ticker,
      yahooIdentity,
      price ? `${price.priceNative} ${price.currency}` : "",
      price ? price.fx : "",
      priceThb,
      price?.source ?? "Ticker rename",
      price?.quoteTimestamp ?? "",
    ];
  });
  auditRows.push(
    ...request.dividendUpdates.map((dividend) => [
      request.exportedAt,
      request.sourceWorkbook,
      dividend.ticker,
      tickerMap[dividend.ticker] ?? dividend.ticker,
      "Dividend DPS",
      `${dividend.dps} THB`,
      "",
      "",
      "Edit Mode",
      "",
    ]),
  );
  if (request.whtRate !== undefined) {
    auditRows.push([
      request.exportedAt,
      request.sourceWorkbook,
      "",
      "",
      "Withholding tax rate",
      `${request.whtRate * 100}%`,
      "",
      "",
      "Edit Mode",
      "",
    ]);
  }

  const existing = workbook.Sheets["Dashboard Audit"];
  const existingRows = existing
    ? (XLSX.utils.sheet_to_json(existing, {
        header: 1,
        raw: true,
        defval: "",
      }) as unknown[][])
    : [];
  const rows = existingRows.length ? [...existingRows, ...auditRows] : [auditHeader, ...auditRows];
  const auditSheet = XLSX.utils.aoa_to_sheet(rows);
  auditSheet["!cols"] = auditHeader.map((header) => ({ wch: Math.max(header.length + 2, 16) }));

  if (existing) {
    workbook.Sheets["Dashboard Audit"] = auditSheet;
  } else {
    XLSX.utils.book_append_sheet(workbook, auditSheet, "Dashboard Audit");
  }
  return auditRows;
}

function exportFilename(sourceWorkbook: string, exportedAt: string) {
  const base = sourceWorkbook.replace(/\.xlsx$/i, "") || "Portfolio_Accounting";
  const date = new Date(exportedAt);
  const stamp = Number.isNaN(date.getTime())
    ? "edited"
    : date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "").slice(0, 13);
  return `${base}_edited_${stamp}.xlsx`;
}

export function exportEditedWorkbook(
  source: ArrayBuffer,
  request: WorkbookEditRequest,
): WorkbookEditResult {
  validateRequest(request);
  const workbook = XLSX.read(source, {
    type: "array",
    cellFormula: true,
    cellStyles: true,
    cellNF: true,
    cellText: false,
  });
  const tickerMap = getTickerMap(request.renames);

  applyPriceUpdates(workbook, request.priceUpdates);
  applyDividendUpdates(workbook, request.dividendUpdates, request.whtRate);
  applyTickerRenames(workbook, tickerMap);
  const auditRows = upsertAuditSheet(workbook, request, tickerMap);

  workbook.Workbook ??= {};
  workbook.Workbook.CalcPr = {
    calcMode: "auto",
    fullCalcOnLoad: "1",
    forceFullCalc: "1",
  };

  return {
    bytes: asArrayBuffer(
      XLSX.write(workbook, {
        bookType: "xlsx",
        type: "array",
        compression: true,
      }),
    ),
    filename: exportFilename(request.sourceWorkbook, request.exportedAt),
    auditRows,
  };
}
