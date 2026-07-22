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

## Symbol discovery

The Analyzer starts with an empty search field. A persisted GOOGL snapshot may
load into the page as the latest saved research, but it must never be copied
into the search input.

- The deployed client contains a versioned, generated catalog of active U.S.
  non-ETF symbols from Nasdaq Trader's listed-symbol directories. It is a hint
  catalog, not a market-data source.
- Search is local to the browser: it matches normalized ticker prefixes and
  fragments plus normalized company-name word prefixes and fragments. For
  example, `A` includes `AAPL`, `AMZN`, and `ARM`; `AMA` and `Amazon` surface
  `AMZN — Amazon.com, Inc.`.
- The hint list is an accessible keyboard-selectable listbox. Selecting a hint
  inserts its ticker; it does not trigger an analysis request. A user can also
  enter a valid U.S. ticker directly and explicitly press Refresh analysis.
- Catalog generation is a development/deploy artifact (`npm run
  catalog:stocks`), not a Railway database table, runtime API, provider-key
  request, or per-keystroke network call. The refresh endpoint remains the
  source-of-truth validation step because a listed symbol can still be
  unavailable from Tiingo.

## Data sources

| Metric | Provider | Runtime variable | Notes |
| --- | --- | --- | --- |
| EOD price, adjusted close, split/dividend data | Tiingo | `TIINGO_API_KEY` | Required for live refresh; cached in PostgreSQL. |
| Historical P/E | Tiingo Fundamentals | `TIINGO_API_KEY` with fundamentals entitlement | Optional provider response; missing data remains visible as unavailable. |
| Current forward P/E | FMP analyst estimates | `FMP_API_KEY` | Optional. Calculated from latest close divided by next annual consensus EPS. |
| Historical forward P/E | Point-in-time estimates provider | future | Out of scope until a licensed point-in-time source is supplied. |
| Ticker/company hints | Generated Nasdaq Trader directory catalog | none | Bundled with the deployed client; no database or runtime request. |

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

## Chart interaction and axes

The Analyzer uses a Yahoo-inspired EOD chart interaction while retaining the
Ghibli Countryside Ledger palette, paper texture, rounded cards, and existing
page layout. It does not copy Yahoo's dark theme.

Every Analyzer line chart is Cartesian: the horizontal axis is the
chronological date (shown as months for daily data and years for annual data),
and the vertical axis is the metric value. The numeric Y-axis ticks are visible
on the **right**, like a market chart. Price charts label that scale as USD
price; valuation charts label it as P/E.

The primary price-chart controls offer `1M`, `6M`, `YTD`, `1Y`, `5Y`, `10Y`,
and `15Y`, derived only from the stored daily EOD series. `1D`, `5D`,
intraday, and volume bars are expressly out of scope for this version because
they require a distinct intraday/volume data contract.

Hovering with a mouse or tapping a chart shows a client-only crosshair and
tooltip with the exact observation date and formatted value, plus a right-edge
price tag at the crosshair. The chart is downsampled only for drawing, so the
tooltip identifies the displayed sampled observation; it never requests a
provider, Railway, or database query.

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
5. Symbol-search tests prove `AMA` reaches AMZN/Amazon, `A` includes AAPL,
   AMZN, and ARM, blank input yields no default suggestion, and the UI has no
   prefilled GOOGL input.
