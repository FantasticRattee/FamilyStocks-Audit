# Stock Audit — Project Operations Guide

> **Purpose:** one practical map of the accounting workbook, GitHub codebase,
> Railway production service, and the steps required to keep them synchronized.
> Last verified: **3 Aug 2026** for the canonical workbook; Railway import is pending.

## Start here

| Question | Correct place to look |
|---|---|
| What is the audited accounting record? | `../Portfolio_Accounting.xlsx` |
| What broker evidence supports it? | `../Transactions/` |
| What code is deployed? | This `dashboard/` Git repository, branch `main` |
| Where does the live dashboard read/write? | Railway PostgreSQL, through the production service |
| How do I safely update the live holdings? | Update the canonical workbook, push code/seed if needed, then import the canonical workbook directly |

The accounting workbook is the **canonical audit record**. Railway PostgreSQL
is the **live shared dashboard record after a canonical import**. GitHub
contains the dashboard implementation and its embedded fallback seed; a Git
push alone does not replace the production portfolio database.

## System map

```mermaid
flowchart LR
    E[Broker screenshots / videos\nTransactions/] --> X[Portfolio_Accounting.xlsx\ncanonical six-sheet audit]
    X --> S[initial-workbook.ts\nembedded fallback seed]
    S --> G[GitHub main\ndashboard source]
    G --> R[Railway app deployment]
    X -->|Canonical import| P[Railway PostgreSQL\nlive holdings + settings]
    Q[Google Finance + SET public pages] -->|Refresh market prices| P
    P --> W[Production dashboard\nfamilystocks-audit-production.up.railway.app]
```

### What each layer owns

| Layer | Owns | Must not be used as |
|---|---|---|
| `Portfolio_Accounting.xlsx` | transactions, cost basis, shareholder capital, historical dividend record, current forecast inputs, accounting totals | A disposable dashboard export |
| `Transactions/` | evidence for new buys, sells, fees, and transfers | A replacement for the reconciled ledger |
| GitHub `main` | UI, server/API logic, tests, README, embedded fallback seed | The live portfolio database |
| Railway PostgreSQL | imported live holdings/settings, persisted quotes, import metadata, Analyzer snapshots | The only historical accounting ledger |
| Dashboard export | a one-sheet four-column transport file | A replacement for the six-sheet audit workbook |

## Current canonical state — 3 Aug workbook reconciled; Railway import pending

The canonical `Portfolio_Accounting.xlsx` and embedded seed include the owner
correction, the available broker-history reconciliation, and the completed
orders through **3 Aug 2026**. A public market refresh may replace the saved
audit marks after canonical import, but must not change units or cost basis.

| Holding | Owner/account | Units | Entry price / audit value |
|---|---|---:|---:|
| GOOGL | Mom | 5 | THB57,628.52 cost (USD1,717.67 / five-share allocation) |
| GOOGL | Rattee | 70 | THB851,302.33 cost (65 prior shares + five-share allocation) |
| META | Mom | 12 | THB221,450.76 cost (USD6,600.54) |
| META | Rattee | 30 | THB552,250.99 cost (USD16,460.34) |
| AAPL | Mom | 35 | THB355,828.41 cost; saved mark THB354,125.17 |
| MU | Mom | 4 | THB108,037.32 cost; saved mark THB108,240.44 |
| NVDA | Mom | 45 | THB309,610.70 cost; saved mark THB309,731.08 |
| KBANK | Shared | 630 | THB181.804905 average cost; saved mark THB242.00 |
| CASH | Shared | 1 | THB95,810.50 confirmed whole-portfolio broker snapshot |

Shared capital remains THB2,155,932.19: Mom 57.9796%, Rattee 28.1053%, and
Ryu 13.9151%. SCB has zero active shares after the 27 Jul 2026 sale. The
canonical total market value is THB2,634,334.35, unrealized P&L is
-THB32,122.27, realized P&L is THB366,562.41, and total P&L is
THB334,440.14.

The 3 Aug Mom orders are AAPL buy 50 / sell 15, MU buy 10 / sell 6, and NVDA
buy 35 plus buy 10. They use the user-approved USD/THB reference 33.254 and
leave AAPL 35, MU 4, and NVDA 45. Time-bounded formulas record AAPL realized
P&L of -THB808.77 and MU realized P&L of +THB225.20; no future buy is included
in a sold cost.

### Accounting treatment and live-state gap

Treat the earlier 65-share GOOGL ownership correction as a current-position
correction until a dated internal-transfer record and FX / settlement evidence
are available. Do not invent a Mom sale or realized P&L for that earlier
transfer. The dated U.S. buys reduce Shared CASH after the confirmed SCB gain
removal, but are **not** new external personal capital. GOOGL, META, AAPL, MU,
and NVDA are personal positions and must never change shared-capital
percentages, KBANK ownership, or the dividend forecast.

The 3 Aug six-order net cash flow is THB774,060.01. It would leave a ledger
residual of THB378,524.82, whereas the user-confirmed actual broker cash
snapshot is THB95,810.50. The THB282,714.32 difference is intentionally an
unresolved reconciliation item: do not turn it into profit, new capital, an
owner allocation, or a synthetic transaction without broker evidence.

The live Railway PostgreSQL portfolio remains pre-import until the next
canonical import. The required post-import state is nine active
holding rows: GOOGL Mom 5, GOOGL Rattee 70, META Mom 12, META Rattee 30, AAPL
Mom 35, MU Mom 4, NVDA Mom 45, KBANK Shared 630, and CASH Shared 1 at
THB95,810.50.

## Canonical Excel workbook

Path: `../Portfolio_Accounting.xlsx`

The workbook must keep exactly these six sheets:

1. `Summary` — formula-driven market value, unrealized/realized P&L and totals.
2. `Shareholders` — shared contributed capital, ownership percentages and
   personal positions.
3. `Lot Holdings` — active lots and retained historical lots.
4. `Dividends` — historical paid dividend and the current-capital forecast.
5. `Holdings` — current active positions, including Shared `CASH`.
6. `Transactions` — full audit ledger and evidence notes.

### Accounting rules that protect the audit

- `CASH` is a Shared-only THB row: `Units = 1`, and entry price equals the
  confirmed whole-portfolio broker cash snapshot. It has no quote or dividend
  eligibility, and is not a synthetic balancing transaction.
- SCB is a historical zero-quantity holding after the 27 Jul 2026 sale; retain
  its lots and sell rows for traceability.
- Shared capital percentages allocate shared cash and KBANK. Personal GOOGL,
  META, AAPL, MU, and NVDA belong to their named owners only and do not dilute
  the dividend forecast. Their purchase cost reduces Shared CASH as a funding
  classification only; it is not their owners' externally contributed capital.
- The current dividend forecast uses shareholder shared capital as its yield
  denominator; it does not use shared cash or market value.
- A sale's realized P&L must use only purchase cost existing before that sale.
  Never use a whole-ledger average that includes future buys, and never hide a
  missing historical cost basis with `IFERROR`.
- Start every factual accounting change from broker evidence. Create a dated
  backup before editing the canonical workbook.

## Dashboard repository and GitHub

- Repository directory: `dashboard/`
- GitHub remote: `https://github.com/FantasticRattee/FamilyStocks-Audit.git`
- Deployment branch: `main`

Important source files:

| Responsibility | Location |
|---|---|
| Dashboard UI | `app/dashboard/Dashboard.tsx` |
| Workbook parsing/calculation | `app/dashboard/model.ts` |
| Canonical/shared import contract | `app/dashboard/shared-portfolio.ts` |
| PostgreSQL persistence | `app/dashboard/postgres-portfolio-repository.ts` |
| Import route | `app/dashboard/portfolio-api.ts` |
| Public market refresh | `app/dashboard/market-api.ts`, `app/dashboard/live-market.ts` |
| Server runtime adapter | `worker/index.ts` |
| Embedded fallback workbook | `app/dashboard/initial-workbook.ts` |
| Change-impact map | `DEPENDENCIES.md` |

Use `git log -1 --oneline` and the Railway Deployment view to identify the
exact active source revision. Do not paste database URLs, passwords, or API
keys into Git, Excel, documentation, screenshots, or chat exports.

## Railway production

Production dashboard: <https://familystocks-audit-production.up.railway.app/>

Railway runs the dashboard service and PostgreSQL. It needs server-only
variables such as:

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
TIINGO_API_KEY=<only needed for a new Analyzer refresh>
FMP_API_KEY=<optional; current Forward P/E only>
```

Never document the values. Change a Railway variable through the Railway UI
and redeploy; do not place it in source control.

### Production API responsibilities

| Endpoint | Purpose |
|---|---|
| `GET /api/portfolio` | Load current holdings, settings, stored quotes and import metadata. |
| `POST /api/portfolio/import` | Passwordless, transactional import of canonical audit or minimal holdings workbook. |
| `GET /api/market/refresh` | Refresh GOOGL/META/AAPL/NVDA/MU/USDTHB from Google Finance and SCB/KBANK from SET public pages. |
| `/api/analyzer*` | Separate U.S.-stock historical-analysis surface; never changes portfolio accounting. |

`Refresh market prices` changes valuation only. It never changes units, entry
price, shareholder capital, transactions, or cost basis. The public sources can
be delayed; if a source fails, the last persisted quote is retained.

## Standard operating runbook

### A. Reconcile a real broker change

1. Save the broker evidence under `../Transactions/` with a meaningful name.
2. Copy `Portfolio_Accounting.xlsx` to a dated backup before editing.
3. Update `Transactions` first. Then update only the dependent sheets that the
   transaction changes: `Lot Holdings`, `Holdings`, `Summary`, `Shareholders`,
   and/or `Dividends`.
4. Recalculate and reconcile quantity, native price, FX, fees, cost basis,
   realized P&L, and the shareholder totals. Do not use current market price
   as a historical cost, or future purchases when calculating an earlier sale.
5. Confirm the six-sheet contract remains intact and scan key formulas for
   errors.
6. Regenerate `app/dashboard/initial-workbook.ts` whenever canonical workbook
   data or layout changes.

### B. Verify and version the dashboard

From `dashboard/`:

```bash
npm run sync:initial-workbook
npm run typecheck
npm run lint
npm test
git status --short
git add <intended files>
git commit -m "<intentional change summary>"
git push origin main
```

Before every push, scan staged content for secrets and local machine paths.
GitHub `main` is the deployment source, but a successful build does not itself
update the shared portfolio rows in PostgreSQL.

### C. Apply the audit to production

1. Wait for the Railway deployment triggered by the GitHub push to become
   active.
2. Import the **canonical six-sheet** `Portfolio_Accounting.xlsx` for a full
   audit/settings replacement. Use the one-sheet minimal format only when the
   intent is explicitly holdings-only.
3. Confirm the import metadata, audit date, owner/account, ticker, units, and
   cash value are correct.
4. Click `Refresh market prices` after the import. Confirm every active
   market-priced ticker has a source link/timestamp (GOOGL, META, AAPL, NVDA,
   MU use Google Finance; SCB and KBANK use SET); CASH is retained at its
   imported amount.
5. Verify `/api/portfolio` and the visible dashboard agree. Check a second
   device/browser if the goal is to confirm shared persistence.

### D. Recover from a bad import

1. Do not edit the database manually first.
2. Re-import the last known-good canonical workbook (or a dated backup).
3. Verify the import metadata and holdings through `/api/portfolio`.
4. Re-run market refresh only after the correct canonical holdings are live.
5. Preserve the bad file and evidence for audit traceability rather than
   silently overwriting it.

## Import/export rules

The passwordless importer accepts one of two formats:

| Format | Use it for | Effect |
|---|---|---|
| Canonical audit workbook | Accounting updates | Replaces holdings **and** audit settings atomically. |
| Minimal one-sheet `Holdings` workbook | Deliberate holdings-only transport | Replaces current holdings but retains portfolio settings. |

The minimal sheet must contain exactly these columns, in order:

```text
Ticker | Owner/Account | Entry Price | Units
```

Supported owners are `Shared`, `Mom`, `Rattee`, and `Ryu`. Supported active
tickers are `GOOGL`, `META`, `AAPL`, `NVDA`, `MU`, `SCB`, `KBANK`, and `CASH`;
`CASH` is only valid for `Shared`. A canonical workbook may retain other
tickers in its historical `Transactions` ledger, but they must not become
active holdings unless active ticker support is deliberately added. Dashboard
exports are intentionally minimal and must not replace the canonical accounting
workbook.

## Common pitfalls

- **Git push succeeded but dashboard numbers did not change:** code deployed,
  but the canonical workbook was not imported into Railway PostgreSQL.
- **Import says “exactly one sheet named Holdings”:** a minimal import was
  selected but a six-sheet canonical workbook was expected, or vice versa.
- **Import rejects a supported ticker:** production code is stale; deploy the
  current supported-ticker code before retrying.
- **Market price looks old:** market refresh is manual and public sources can
  be delayed; refresh and inspect source links before changing cost basis.
- **A personal position changes pool numbers:** stop. Personal positions must
  not affect shared ownership or dividend allocation.
- **A total profit does not reconcile with one sale:** separate sale proceeds,
  sold cost basis, remaining assets (for example KBANK), pre-existing cash,
  and historical realized P&L before allocating anyone's share.
- **An older sale P&L changes after a new buy:** stop and repair the historical
  cost formula. A sale must not include future buys in its cost basis.

## Documentation map

| Document | Use it for |
|---|---|
| `README.md` | App behavior, local development, API and Railway configuration. |
| `DEPENDENCIES.md` | Code-level change impact and test checklist. |
| `docs/PROJECT_OPERATIONS.md` | This end-to-end operator guide. |
| `../Handoff.md` | Latest audited accounting state and continuation notes. |
| `../DEPENDENCIES.md` | Cross-artifact sync checklist for workbook, GitHub and Railway. |
| `docs/specs/` | Historical/approved design decisions; use the newest applicable spec. |
