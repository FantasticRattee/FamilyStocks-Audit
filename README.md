# Stock Audit Dashboard

Interactive family-portfolio dashboard backed by Railway PostgreSQL. Every
device loads the same holdings and the latest successfully refreshed market
prices. The dashboard accepts the canonical six-sheet audit workbook as well
as a small raw-holdings import/export workbook.

## Data ownership

Railway PostgreSQL is the shared source of truth for:

- current holdings;
- the latest successful `GOOGL`, `SCB`, `KBANK`, and `USDTHB` quotes;
- non-derived family, dividend, and audit settings;
- import metadata.

The embedded audit snapshot is used to seed an empty database and to keep a
safe read-only view visible if the database is unavailable. Browser IndexedDB
is not used, so one device cannot silently override another with a stale
workbook.

## Excel import formats

### Canonical audit workbook

The dashboard accepts the canonical `Portfolio_Accounting.xlsx` when it
contains these sheets:

`Summary`, `Shareholders`, `Lot Holdings`, `Dividends`, `Holdings`, and
`Transactions`.

The browser parses the audit first, then the authenticated server validates and
atomically replaces both current holdings and portfolio settings in PostgreSQL.
This carries forward the audit date, default FX, realized-P&L figure,
shareholder ownership, dividend settings, historical dividend record, and
transaction snapshot. Existing persisted market quotes are retained.

### Minimal holdings workbook

Import and export use exactly one sheet named `Holdings` with these four
columns in this order:

| Ticker | Owner/Account | Entry Price | Units |
|---|---|---:|---:|
| SCB | Shared | 100.00 | 1000 |
| GOOGL | Rattee | 370.00 | 50 |

- `Entry Price` is the historical per-unit entry price in the ticker's native
  currency: USD for GOOGL and THB for SCB/KBANK.
- `Units` is the current quantity held.
- Supported owner labels are `Shared`, `Mom`, `Rattee`, and `Ryu`.
- Supported tickers are currently `GOOGL`, `SCB`, and `KBANK`.
- Current price, FX, market value, P&L, allocation, dividend forecasts, source
  URLs, and timestamps are derived by the application and are never exported
  to Excel.

Minimal import replaces shared holdings transactionally and preserves existing
portfolio settings. Canonical audit import replaces holdings and settings in
the same transaction. Both require the Edit Mode password every time, and any
invalid input or incorrect password leaves the existing portfolio unchanged.
Export creates a fresh minimal `Portfolio_Holdings_YYYY-MM-DD.xlsx`; it never
overwrites the canonical audit workbook.

## Market refresh

`Refresh market prices` is public and manual. Each click fetches the four
allow-listed market keys from free public sources without an API key:

- Google Finance public quote pages: `GOOGL` and `USDTHB`.
- Official SET public quote pages: `SCB` and `KBANK`.

- Successful quotes are saved to PostgreSQL and immediately become the shared
  values for every device.
- Every click requests fresh provider pages; there is no API-use cooldown.
- If one key fails, its last successful database value is retained while the
  successful keys are updated.
- If a key has never succeeded, the embedded audit seed remains the visible
  fallback and the status line reports the failure.
- No refresh changes entry price, units, transactions, or cost basis.

These are public quote pages, not licensed real-time exchange feeds. They may
be delayed and their HTML can change. The parser only accepts the configured
symbol/currency/exchange pages, and the UI shows the source links, freshness,
and any retained values. No OpenAI request or token charge is made.

## Edit Mode

The dashboard is public, but opening Edit Mode and importing a workbook require
`EDIT_MODE_PASSWORD`. The Worker checks it server-side. The password is never
stored in PostgreSQL, browser storage, a cookie, a URL, or an exported workbook.
Closing Edit Mode relocks it.

## Run locally

Create an ignored `.dev.vars` from `.dev.vars.example` and set:

```text
DATABASE_URL=postgresql://...
EDIT_MODE_PASSWORD=...
```

No market-data API key is required. Then run:

```bash
npm install
npm run dev
```

Open `http://localhost:3001`. Local development is intentionally pinned to one
port. Production does not hardcode a port and honors Railway's `PORT`.

Without `DATABASE_URL`, the embedded snapshot still renders, but shared import
and market refresh return a clear 503 error instead of pretending they were
saved.

## Deploy on Railway

Use:

```text
Build command: npm run build
Start command: npm run start
```

Add a PostgreSQL service to the same Railway project. In the
`FamilyStocks-Audit` service, configure:

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
EDIT_MODE_PASSWORD=<production password>
```

Use Railway's variable reference picker for `DATABASE_URL`; do not copy a
production connection string into Git. Redeploy after changing variables. The
application creates its four tables on first access and atomically seeds an
empty database from the validated embedded snapshot.

After a real market refresh, the dashboard should show the fresh timestamp,
source links, and refreshed/retained status. A second click should request the
public source pages again.

## API flow

- `GET /api/portfolio` loads or atomically seeds shared holdings, settings,
  persisted quotes, and latest import metadata.
- `POST /api/portfolio/import` verifies the Edit Mode password, validates every
  raw holding, and replaces holdings in one transaction.
- `GET /api/market/refresh` fetches Google Finance and SET public quote pages,
  upserts successful quotes, and returns the merged persisted snapshot.
- `POST /api/edit-auth` verifies the Edit Mode password without creating a
  session.

Secrets are read only by `worker/index.ts` from Worker bindings or Railway's
Node runtime environment and are never bundled into browser JavaScript.

## Mobile and 3D behavior

The same dashboard is preserved on phones and desktop. It is optimized for
390×844 and remains usable down to 320×568. The family artwork fills the hero
stage, horizontal navigation remains scrollable, and the interactive R3F
allocation ring remains touch/click selectable. When WebGL is unavailable, a
clickable visual fallback preserves the data interaction.

The approved **Ghibli Countryside Ledger** presentation uses warm paper,
forest green, watercolor sky, sunlight accents, and rough painted-clay R3F
materials. It is a visual layer only: portfolio math, persisted quotes,
PostgreSQL data, Edit Mode, and the four-column Excel contract remain unchanged.

## Accounting rules preserved

- Shared pool = SCB + KBANK only.
- Personal positions do not change the shared-pool dividend forecast.
- The April 2026 dividend remains historical; the next forecast is derived
  from current shared capital and the stored recurring-yield assumptions.
- Market refresh changes current valuation only, never historical entry price
  or cost basis.
- Realized P&L remains an imported legacy audit setting and requires lot-level
  review before settlement use.

## Verify

```bash
npm run typecheck
npm run lint
npm test
```

The unit suite covers the four-column workbook contract, shared import auth,
database quote retention semantics, and market validation. `npm test` also
builds the production app and runs rendered-runtime checks.
