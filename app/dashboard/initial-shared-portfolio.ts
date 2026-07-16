import { INITIAL_WORKBOOK_BASE64 } from "./initial-workbook";
import type { MarketQuote } from "./market-data";
import { parseWorkbook } from "./model";
import type { SharedPortfolioState } from "./portfolio-api";
import {
  SUPPORTED_HOLDING_TICKERS,
  validateSharedHoldings,
  type PortfolioSettings,
} from "./shared-portfolio";

const base64ToArrayBuffer = (encoded: string) => {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
};

const initialSnapshot = parseWorkbook(
  base64ToArrayBuffer(INITIAL_WORKBOOK_BASE64),
  "Portfolio_Accounting.xlsx",
);

const initialHoldings = validateSharedHoldings(
  initialSnapshot.holdings.map((holding) => ({
    ticker: holding.ticker,
    ownerAccount: holding.category === "shared" ? "Shared" : holding.owner,
    entryPrice:
      holding.currency === "USD"
        ? holding.avgCostThb / initialSnapshot.defaultFx
        : holding.avgCostThb,
    units: holding.quantity,
  })),
);

const initialSettings: PortfolioSettings = {
  schemaVersion: 1,
  asOfDate: initialSnapshot.asOfDate,
  defaultFx: initialSnapshot.defaultFx,
  totalRealizedPnl: initialSnapshot.summary.totalRealizedPnl,
  shareholders: initialSnapshot.shareholders,
  dividend: {
    whtRate: initialSnapshot.dividend.whtRate,
    lines: initialSnapshot.dividend.lines.map((line) => ({
      ticker: line.ticker,
      dps: line.dps,
      note: line.note,
    })),
  },
  historicalDividend: initialSnapshot.historicalDividend,
  transactions: initialSnapshot.transactions,
};

const quoteTimestamp = "2026-06-15T00:00:00.000+07:00";

const initialQuotes = initialSnapshot.holdings.reduce<Record<string, MarketQuote>>(
  (quotes, holding) => {
    if (quotes[holding.ticker]) return quotes;
    const config =
      SUPPORTED_HOLDING_TICKERS[
        holding.ticker as keyof typeof SUPPORTED_HOLDING_TICKERS
      ];
    if (!config) return quotes;
    quotes[holding.ticker] = {
      symbol: holding.ticker,
      price:
        holding.currency === "USD"
          ? holding.importedPriceThb / initialSnapshot.defaultFx
          : holding.importedPriceThb,
      currency: holding.currency,
      exchange: holding.currency === "USD" ? "NASDAQ" : "SET",
      marketState: "AUDIT",
      quoteTimestamp,
      source: "Embedded audit seed",
      freshness: "initial database seed",
    };
    return quotes;
  },
  {},
);

initialQuotes.USDTHB = {
  symbol: "USDTHB",
  price: initialSnapshot.defaultFx,
  currency: "THB",
  exchange: "FX",
  marketState: "AUDIT",
  quoteTimestamp,
  source: "Embedded audit seed",
  freshness: "initial database seed",
};

export const INITIAL_SHARED_PORTFOLIO_STATE: SharedPortfolioState = {
  holdings: initialHoldings,
  settings: initialSettings,
  quotes: initialQuotes,
  latestImport: null,
};

export const INITIAL_DASHBOARD_SNAPSHOT = initialSnapshot;
