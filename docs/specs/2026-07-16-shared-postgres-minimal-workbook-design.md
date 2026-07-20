# Shared PostgreSQL Portfolio and Minimal Workbook Design

> Market-refresh details that name OpenAI were superseded on 20 Jul 2026 by
> [`2026-07-20-free-public-market-sources-design.md`](./2026-07-20-free-public-market-sources-design.md).
> The shared PostgreSQL and workbook portions remain current.

## Goal

Make the family portfolio and its latest market prices consistent across every
device. Railway PostgreSQL becomes the shared source of truth. Excel becomes a
small, auditable transport/backup file containing only raw position inputs.

## Approved decisions

- Railway PostgreSQL is the only shared database.
- Anyone may run the public market-price refresh.
- Importing/replacing the shared portfolio requires the existing Edit Mode
  password.
- A refresh updates every successfully sourced quote and retains the previous
  database value for each failed quote.
- The initial supported market keys remain `GOOGL`, `SCB`, `KBANK`, and
  `USDTHB`.
- Every device loads the same holdings and latest persisted quotes.
- The minimal Excel contract is exactly `Ticker`, `Owner/Account`,
  `Entry Price`, and `Units`.

## Source-of-truth boundaries

PostgreSQL stores:

- the current shared holdings;
- the latest successful quote per market key;
- portfolio settings that are not derived from a holding row, including family
  pool contributions/ratios and the historical dividend reference assumption;
- import metadata for auditability.

Excel stores only raw holding rows. It must not contain current price, FX,
market value, P&L, allocation, family equity, forecast dividend, source URLs,
or refresh timestamps.

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

- `market_key` — primary key (`GOOGL`, `SCB`, `KBANK`, `USDTHB`)
- `symbol`, `price`, `currency`, `exchange`, `market_state`
- `quote_timestamp`, `source`, `freshness`
- `sources` — JSON array of auditable web-search links
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

Accepts the Edit Mode password and a validated minimal holding array. The server
verifies the password, validates all rows again, and replaces holdings plus
records import metadata in one transaction. Any invalid row rolls back the
whole import. Existing market quotes for supported tickers remain available.

### `GET /api/market/refresh`

Keeps the approved OpenAI-only sourced lookup and focused missing-key retry.
After lookup, the server upserts only successful quotes, then returns the merged
database snapshot. A failed key is marked as retained and continues using its
previous persisted value. If no previous value exists, the normal no-quote
failure remains visible.

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
- Export creates a fresh minimal workbook from the current database holdings.
- Import supports the new minimal contract. The legacy workbook is used only
  for the initial database seed and is not regenerated with derived fields.

## Calculation compatibility

The existing dashboard presentation remains. A database adapter converts the
minimal holdings plus settings into the existing calculation model so family
ownership, allocation, P&L, and dividend forecast remain synchronized. Ticker
currency/category mappings remain explicit and covered by tests.

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

- `DATABASE_URL`, `OPENAI_API_KEY`, and `EDIT_MODE_PASSWORD` remain server-only
  Railway variables.
- Public refresh is intentionally allowed and may incur OpenAI API usage.
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
