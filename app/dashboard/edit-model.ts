import type { MarketQuote, YahooSearchCandidate } from "./market-data";
import { createScenario, type DashboardSnapshot, type Scenario } from "./model";
import type { WorkbookEditRequest } from "./workbook-export";

export type HoldingEdit = {
  targetTicker: string;
  searchQuery: string;
  selectedCandidate?: YahooSearchCandidate;
  quote?: MarketQuote;
  priceSource?: "Yahoo Finance" | "Manual";
};

export type HoldingEdits = Record<string, HoldingEdit>;

const changed = (left: number, right: number) => Math.abs(left - right) > 1e-9;

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

export function buildWorkbookEditRequest(
  snapshot: DashboardSnapshot,
  scenario: Scenario,
  edits: HoldingEdits,
  exportedAt: string,
): WorkbookEditRequest {
  const importedScenario = createScenario(snapshot);
  const activeHoldings = uniqueHoldingsByTicker(snapshot);
  const renames = activeHoldings.flatMap((holding) => {
    const targetTicker = edits[holding.ticker]?.targetTicker.trim().toUpperCase() ?? holding.ticker;
    return targetTicker !== holding.ticker
      ? [{ from: holding.ticker, to: targetTicker }]
      : [];
  });
  const priceUpdates = activeHoldings.flatMap((holding) => {
    const currentPrice = scenario.prices[holding.ticker] ?? importedScenario.prices[holding.ticker];
    const edit = edits[holding.ticker];
    const fxChanged =
      holding.currency === "USD" && changed(scenario.fx, importedScenario.fx);
    const shouldExportPrice =
      changed(currentPrice, importedScenario.prices[holding.ticker]) ||
      fxChanged ||
      Boolean(edit?.quote);
    if (!shouldExportPrice) return [];

    return [
      {
        ticker: holding.ticker,
        priceNative: currentPrice,
        currency: holding.currency,
        fx: scenario.fx,
        source: edit?.priceSource ?? (edit?.quote ? "Yahoo Finance" : "Manual"),
        yahooSymbol: edit?.selectedCandidate?.symbol ?? edit?.quote?.symbol,
        companyName: edit?.selectedCandidate?.name,
        quoteTimestamp: edit?.quote?.quoteTimestamp,
      },
    ];
  });
  const dividendUpdates = snapshot.dividend.lines.flatMap((line) => {
    const dps = scenario.dividendDps[line.ticker] ?? line.dps;
    return changed(dps, line.dps) ? [{ ticker: line.ticker, dps }] : [];
  });
  const whtRate = changed(scenario.whtRate, snapshot.dividend.whtRate)
    ? scenario.whtRate
    : undefined;

  return {
    sourceWorkbook: snapshot.filename,
    exportedAt,
    holdings: activeHoldings.map((holding) => ({
      ticker: holding.ticker,
      currency: holding.currency,
    })),
    renames,
    priceUpdates,
    dividendUpdates,
    ...(whtRate === undefined ? {} : { whtRate }),
  };
}
