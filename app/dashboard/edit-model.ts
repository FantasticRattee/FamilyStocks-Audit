import type { MarketQuote, YahooSearchCandidate } from "./market-data";
import type { DashboardSnapshot } from "./model";

export type HoldingEdit = {
  targetTicker: string;
  searchQuery: string;
  selectedCandidate?: YahooSearchCandidate;
  quote?: MarketQuote;
  priceSource?: "Yahoo Finance" | "Manual";
};

export type HoldingEdits = Record<string, HoldingEdit>;

const uniqueHoldingsByTicker = (snapshot: DashboardSnapshot) =>
  Array.from(
    new Map(snapshot.holdings.map((holding) => [holding.ticker, holding])).values(),
  );

export function createHoldingEdits(snapshot: DashboardSnapshot): HoldingEdits {
  return Object.fromEntries(
    uniqueHoldingsByTicker(snapshot).map((holding) => [
      holding.ticker,
      {
        targetTicker: holding.ticker,
        searchQuery: holding.ticker,
      },
    ]),
  );
}

export function getHoldingDisplayTicker(ticker: string, edits: HoldingEdits) {
  return edits[ticker]?.targetTicker.trim() || ticker;
}
