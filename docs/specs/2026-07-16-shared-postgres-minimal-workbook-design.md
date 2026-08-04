# Shared PostgreSQL Portfolio and Minimal Workbook Design

> Market-refresh details that name OpenAI were superseded on 20 Jul 2026 by
> [`2026-07-20-free-public-market-sources-design.md`](./2026-07-20-free-public-market-sources-design.md).
> The shared PostgreSQL and workbook portions remain current. The supported
> market-key list was amended on 2 Aug 2026 to add `META`.
>
> **Access-control update (4 Aug 2026):** the owner approved passwordless Edit
> Mode and workbook import. The implementation no longer reads
> `EDIT_MODE_PASSWORD`; current operational behavior is documented in
> [`PROJECT_OPERATIONS.md`](../PROJECT_OPERATIONS.md).

## Goal

Make the family portfolio and its latest market prices consistent across every
device. Railway PostgreSQL becomes the shared source of truth. Excel remains
both the six-sheet accounting audit and a small raw-holdings transport/backup
format; the minimal workbook is not a replacement for the canonical audit.

## Approved decisions

- Railway PostgreSQL is the only shared database.
- Anyone may run the public market-price refresh.
- Importing/replacing the shared portfolio requires the existing Edit Mode
  password.
- A refresh updates every successfully sourced quote and retains the previous
  database value for each failed quote.
- The supported market keys are `GOOGL`, `META`, `SCB`, `KBANK`, and
  `USDTHB`.
- `CASH` is a supported shared THB holding, not a market key: it retains its
  imported audit value and is excluded from quote refresh and dividends.
- Every device loads the same holdings and latest persisted quotes.
- The minimal Excel contract is exactly `Ticker`, `Owner/Account`,
  `Entry Price`, and `Units`.

## Source-of-truth boundaries

PostgreSQL stores:

- the current shared holdings;
- the latest successful quote per market key; imported `CASH` has no quote row;
- portfolio settings that are not derived from a holding row, including family
  pool contributions/ratios and the historical dividend reference assumption;
- import metadata for auditability.

The **minimal** Excel transport workbook stores only raw holding rows. It must
not contain current price, FX, market value, P&L, allocation, family equity,
forecast dividend, source URLs, or refresh timestamps. The canonical six-sheet
audit intentionally retains formula-derived accounting fields and is not the
minimal export format.

The application derives every display metric at runtime from raw holdings,
persisted settings, and persisted quotes.

## PostgreSQL schema

### `portfolio_holdings`

- `id` — stable generated primary key
- `position_order` — deterministic display order
- `ticker` — normalized uppercase ticker
- `owner_account` — owner or account label such as `Shared` or `Rattee`
- `entry_price` — positive native-currency price per unit
- `units` — positive quantity
- `created_at`, `updated_at`

### `market_quotes`

- `market_key` — primary key (`GOOGL`, `META`, `SCB`, `KBANK`, `USDTHB`)
- `symbol`, `price`, `currency`, `exchange`, `market_state`
- `quote_timestamp`, `source`, `freshness`
- `sources` — JSON array of auditable public-source links
- `updated_at`

### `portfolio_settings`

- singleton row containing the existing family shareholder/pool settings,
  realized-P&L audit figure, dividend reference data, and other non-derived
  configuration required by the existing dashboard
- seeded from the current validated embedded audit snapshot

### `portfolio_imports`

- append-only import metadata: original filename, imported time, row count, and
  a content hash
- no API key or Edit Mode password is stored

## API contract

### `GET /api/portfolio`

Returns the current holdings, settings, persisted quote snapshot, and import
metadata. If the database is empty, the server atomically seeds it from the
validated embedded snapshot before responding.

### `POST /api/portfolio/import`

Accepts the Edit Mode password and either a validated minimal holding array or
canonical-audit settings. The server verifies the password, validates all rows
again, atomically replaces holdings (and canonical settings when supplied), and
records import metadata. Any invalid row rolls back the whole import. Existing
market quotes for market-priced tickers remain available.

### `GET /api/market/refresh`

Fetches the four allow-listed public market keys from Google Finance (`GOOGL`,
`USDTHB`) and official SET pages (`SCB`, `KBANK`) on every manual refresh.
After parsing, the server upserts only successful quotes, then returns the
merged database snapshot. A failed key is marked as retained and continues
using its previous persisted value. `CASH` never requests a quote.

## Dashboard flow

1. Server-render the embedded audit snapshot as a safe initial view.
2. On client load, request `/api/portfolio` and replace holdings/settings/live
   quotes with the shared database state.
3. A successful refresh immediately updates the UI and the database; reloads,
   redeploys, and other devices use that same snapshot.
4. Import remains behind Edit Mode. The browser parses the workbook for fast
   feedback, then the server independently validates and commits it.
5. Browser IndexedDB workbook restoration is removed so stale local holdings
   cannot override PostgreSQL.

## Minimal workbook behavior

- One sheet named `Holdings`.
- Header row: `Ticker`, `Owner/Account`, `Entry Price`, `Units`.
- Text columns are normalized and required.
- Numeric columns are stored as numbers, must be finite and greater than zero,
  and use readable number formats.
- `CASH` is valid only under `Shared`; it represents the whole THB cash balance
  with `Units = 1`, and is neither market-priced nor dividend-eligible.
- Export creates a fresh minimal workbook from the current database holdings.
- Import supports the minimal contract and the canonical six-sheet audit
  (`Summary`, `Shareholders`, `Lot Holdings`, `Dividends`, `Holdings`, and
  `Transactions`). The minimal export is never regenerated with derived fields.

## Calculation compatibility

The existing dashboard presentation remains. A database adapter converts the
minimal holdings plus settings into the existing calculation model so family
ownership, allocation, P&L, and dividend forecast remain synchronized. Ticker
currency/category mappings remain explicit and covered by tests.

For a `current-capital` dividend forecast, the yield denominator is the total
shared capital in the shareholder settings. It is deliberately not the shared
market value or the sum of active holding cost bases: a retained shared `CASH`
balance is part of portfolio value but earns no dividend and must not dilute
the forecast yield.

## Failure behavior

- Database unavailable: keep the embedded snapshot visible and show a clear
  shared-state warning; never claim that a write succeeded.
- Partial market refresh: persist successes, retain prior quotes for failures,
  and label the retained keys.
- Invalid import or wrong password: return an error and preserve the current
  portfolio transactionally.
- Unsupported ticker: reject the import with the exact row and reason until a
  market/currency mapping is added.

## Security

- `DATABASE_URL` and `EDIT_MODE_PASSWORD` remain server-only Railway variables.
- Public refresh uses free public web pages and makes no OpenAI request.
- Import and shared holding replacement require the Edit Mode password on every
  operation; the password is not written to PostgreSQL, browser storage, URLs,
  logs, or exported workbooks.

## Deployment

1. Add Railway PostgreSQL to the existing project.
2. Reference its `DATABASE_URL` from the `FamilyStocks-Audit` service.
3. Deploy schema creation/migration code and the application together.
4. Confirm first-load seeding, cross-device load, partial-refresh merge,
   password-protected import, restart persistence, mobile layout, and R3F.

## Verification

- Unit tests for minimal workbook parsing/export and holding validation.
- Database repository tests with a deterministic fake adapter plus PostgreSQL
  integration checks against Railway after provisioning.
- Route tests for first seed, shared load, import authorization/rollback, quote
  upsert, and partial-refresh retention.
- Full build/render/lint regression checks.
- Production browser loop at 393 x 852 plus a second independent browser load
  proving persisted holdings and quotes are shared.
