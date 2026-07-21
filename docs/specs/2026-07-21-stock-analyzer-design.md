# Stock Analyzer — Tiingo-backed historical research module

Date: 21 Jul 2026

## Decision

Add a read-only `/analyzer` route to the existing Stock Audit dashboard. It is
a research surface for one U.S. stock at a time and does not alter the Excel
audit ledger, portfolio holdings, market-refresh quotes, or Edit Mode flow.

## Scope

The initial release supports any safe U.S. ticker supplied by the user and
shows a durable cached analysis for up to 15 years:

- price chart with 1Y / 5Y / 10Y / 15Y windows;
- monthly and annual split-adjusted average prices;
- price and total-return CAGR for 5, 10, and 15 years;
- historical and current trailing P/E when Tiingo Fundamental data is enabled;
- current forward P/E when an FMP analyst-estimates key is enabled;
- explicit source, cache time, coverage, and missing-data status.

Historical forward P/E is intentionally not synthesized from current analyst
estimates. It remains unavailable until a point-in-time consensus provider
(such as FactSet or a licensed estimates dataset) is connected. The UI must
state this rather than display a misleading historical series.

## Data sources

| Metric | Provider | Runtime variable | Notes |
| --- | --- | --- | --- |
| EOD price, adjusted close, split/dividend data | Tiingo | `TIINGO_API_KEY` | Required for live refresh; cached in PostgreSQL. |
| Historical P/E | Tiingo Fundamentals | `TIINGO_API_KEY` with fundamentals entitlement | Optional provider response; missing data remains visible as unavailable. |
| Current forward P/E | FMP analyst estimates | `FMP_API_KEY` | Optional. Calculated from latest close divided by next annual consensus EPS. |
| Historical forward P/E | Point-in-time estimates provider | future | Out of scope until a licensed point-in-time source is supplied. |

The server makes provider requests. Browser code never receives an API key.

## Storage and refresh

`stock_analyzer_snapshots` stores one normalized JSON payload per ticker,
including raw price/P/E series, source metadata, and fetch timestamp.

- `GET /api/analyzer?symbol=GOOGL` returns the latest cached analysis.
- `POST /api/analyzer/refresh` accepts `{ "symbol": "GOOGL" }`, fetches fresh
  provider data, derives metrics deterministically, stores the snapshot, and
  returns it.
- The interface initially analyzes one ticker at a time. It does not backfill
  all 500 stocks automatically, avoiding accidental high-volume API usage.

## Metric definitions

- **Monthly / annual average:** arithmetic mean of daily split-adjusted closes.
- **Price CAGR:** uses split-adjusted close to compare equivalent shares.
- **Total-return CAGR:** uses dividend-adjusted close when supplied by Tiingo.
- **Trailing P/E:** historical `peRatio` supplied at the observed date; a
  negative or missing value is `N/M` / unavailable.
- **Current forward P/E:** latest close divided by the next annual consensus
  EPS. It is labelled `current consensus`, not point-in-time history.

## Error handling

- No `DATABASE_URL`: the Analyzer returns a clear persistence error.
- No `TIINGO_API_KEY`: cached data stays readable; refresh explains the exact
  missing variable.
- Fundamentals or FMP entitlement unavailable: price analytics still render;
  valuation sections show their source-specific unavailable status.
- Provider failures never overwrite the last successfully cached snapshot.

## Verification

1. Pure metric tests cover CAGR, period averages, annual P/E selection,
   missing/negative valuation handling, and ticker validation.
2. API tests cover cached reads, missing key failures, successful provider
   refreshes, and retention of the last snapshot after a provider failure.
3. Build and render checks cover the `/analyzer` route, the source-status UI,
   and no client-side reference to the API keys.
4. Railway docs name the two optional server-only keys and keep the existing
   audit/workbook contracts unchanged.
