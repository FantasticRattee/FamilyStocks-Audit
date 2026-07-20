# Dashboard change-impact map

Updated: 2026-07-20. Use with the `impact-check` skill before changing shared
portfolio, market data, workbook, runtime, or presentation behavior.

## Canonical artifacts

- **Live app/service:** `app/`, `worker/index.ts`, `vite.config.ts`, and
  `package.json`; GitHub `main` deploys to Railway.
- **Shared data authority:** `app/dashboard/postgres-portfolio-repository.ts`
  backed by Railway PostgreSQL.
- **Raw workbook contract and adapter:**
  `app/dashboard/shared-portfolio.ts`.
- **Shared portfolio routes:** `app/dashboard/portfolio-api.ts` and
  `app/dashboard/initial-shared-portfolio.ts`.
- **Embedded legacy seed:** `app/dashboard/initial-workbook.ts`, generated from
  `../Portfolio_Accounting.xlsx` and parsed by `app/dashboard/model.ts`.
- **Authentication:** `app/dashboard/edit-auth.ts`.
- **Market refresh:** `app/dashboard/market-api.ts`,
  `app/dashboard/portfolio-repository.ts`, `app/dashboard/live-market.ts`, and
  `worker/index.ts`.
- **Dashboard and 3D presentation:** `app/dashboard/Dashboard.tsx`,
  `app/globals.css`, and `public/family-portfolio-hero.png`.
- **Operator documentation:** `README.md`.
- **Approved architecture record:**
  `docs/specs/2026-07-16-shared-postgres-minimal-workbook-design.md`.
- **Approved visual-theme record:**
  `docs/specs/2026-07-17-ghibli-countryside-ledger-theme-design.md`.
- **Approved free market-source record:**
  `docs/specs/2026-07-20-free-public-market-sources-design.md`.
- **Verification:** `tests/*.test.ts` and `tests/rendered-html.test.mjs`.

## Impact matrix

| If you change… | Update together | Verify |
|---|---|---|
| Canonical-audit or four-column workbook validation, owner aliases, ticker support, or export | `shared-portfolio.ts`, `Dashboard.tsx`, `portfolio-api.ts`, `postgres-portfolio-repository.ts`, workbook tests, README | Parse both formats; keep minimal export round trip; verify canonical import atomically updates holdings/settings; authenticated production import |
| Holdings/settings-to-dashboard calculations | `shared-portfolio.ts`, `model.ts`, `initial-shared-portfolio.ts`, calculation tests, accounting notes | Cost basis, category, native currency, allocation, owner equity, P&L, dividend forecast |
| PostgreSQL schema, seeding, transactions, or import metadata | `postgres-portfolio-repository.ts`, `portfolio-api.ts`, `worker/index.ts`, repository/API tests, README deployment | Empty-DB seed, rollback, restart persistence, second browser load |
| Market keys, quote parsing, source requirements, or partial failure | `market-api.ts`, `portfolio-repository.ts`, `postgres-portfolio-repository.ts`, `live-market.ts`, `Dashboard.tsx`, market tests, README | Four fresh Google Finance/SET public-page requests; no API key/cooldown; retain failed keys; source links; production refresh |
| Edit/import authentication | `edit-auth.ts`, `portfolio-api.ts`, `Dashboard.tsx`, `worker/index.ts`, route/render tests | Wrong password 401; correct password succeeds; no secret in bundle/log/DB |
| Railway runtime variables or process/port behavior | `worker/index.ts`, `.dev.vars.example`, `package.json`, README | Local port 3001 only; production honors `PORT`; only DB/password stay server-side |
| Mobile hero, R3F ring, 3D bars, theme, or fallback | `Dashboard.tsx`, `globals.css`, hero asset, rendered tests, responsive/theme specs | Desktop and 393×852; WebGL and clickable fallback; labels do not overlap |

## Internal flow

1. `worker/index.ts` resolves server-only runtime variables and creates one
   cached PostgreSQL repository per connection string.
2. `GET /api/portfolio` calls `portfolio-api.ts` → PostgreSQL. An empty database
   is protected by an advisory transaction lock and seeded from
   `initial-shared-portfolio.ts` exactly once.
3. `Dashboard.tsx` renders the embedded seed first, then loads shared holdings,
   settings, and persisted quotes. It adapts raw holdings through
   `shared-portfolio.ts` into the existing calculation model.
4. Import detects either the canonical six-sheet audit workbook or a one-sheet
   four-column holdings workbook in the browser, requests the Edit Mode
   password, then posts normalized holdings and optional audit settings to
   `/api/portfolio/import`. The server revalidates and atomically replaces
   holdings plus settings for canonical imports; minimal imports replace only
   holdings.
5. Market refresh fetches each allow-listed Google Finance or SET public quote
   page on every click. `market-api.ts` validates the parsed price against the
   configured symbol/currency/exchange and the repository upserts successful
   keys while retaining prior failed keys.
6. Export builds a new minimal workbook directly from current shared raw
   holdings. It never serializes derived display values.

## Data contracts

- Workbook import: either the canonical audit sheets (`Summary`, `Shareholders`,
  `Lot Holdings`, `Dividends`, `Holdings`, `Transactions`) or exactly one
  `Holdings` sheet with `Ticker`, `Owner/Account`, `Entry Price`, `Units`.
- Workbook export: exactly one `Holdings` sheet and exactly `Ticker`,
  `Owner/Account`, `Entry Price`, `Units`.
- Holdings: supported ticker and owner mapping; positive finite native-currency
  entry price and units.
- Shared market keys: `GOOGL`, `SCB`, `KBANK`, `USDTHB`.
- `GET /api/portfolio`: holdings, settings, quote map, latest import metadata,
  and optional market sources.
- Market refresh: quote map plus failures, refreshed/retained keys, fetched
  time, provider, and source links.
- Runtime variables: `DATABASE_URL` and `EDIT_MODE_PASSWORD`.

## Known constraints and debt

- Google Finance and SET quote pages are public pages, not licensed real-time
  exchange feeds. Their values can be delayed or their HTML can change; a
  parsing failure retains the last verified shared quote.
- Only GOOGL, SCB, and KBANK holdings are accepted until ticker currency and
  market mappings are added deliberately.
- GOOGL entry price is native USD; the compatibility adapter converts its cost
  basis using the stored default audit FX assumption.
- Minimal import/export does not carry transactions, realized P&L, shareholder
  pool settings, or dividend assumptions. The canonical audit import updates
  those settings atomically; a future settings UI remains optional rather than
  required for workbook-driven updates.
- Tables are currently created lazily with idempotent SQL. Schema versioned
  migrations should be added before incompatible production schema changes.
- Railway variables are deployment state and are intentionally absent from
  Git; a fresh service must connect PostgreSQL and add its secrets.
