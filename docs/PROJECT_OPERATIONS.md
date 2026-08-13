# Stock Audit — Project Operations Guide

> **Purpose:** one practical map of the accounting workbook, GitHub codebase,
> Railway production service, and the steps required to keep them synchronized.
> Latest canonical reconciliation: **12 Aug 2026**. The pooled portfolio
> closed WDC, rolled GOOGL from 30 to 40 shares, and added META 20 using
> existing cash (no new capital). The live-production status is recorded after
> the canonical import in `../Handoff.md`.

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

## Current canonical state — 12 Aug pooled rotation reconciled

From **5 Aug 2026**, current holdings and cash are a single pooled portfolio.
Historic owner/unit records remain in the ledger, but do not determine active
ownership, future realized P&L, or future dividend allocation.

| Shareholder | Total contributed capital | Allocation |
|---|---:|---:|
| Mom | THB1,250,000.00 | 42.3785% |
| Rattee | THB1,399,606.00 | 47.4506% |
| Ryu | THB300,000.00 | 10.1708% |
| **Total** | **THB2,949,606.00** | **100.0000%** |

| Active pooled holding | Units / value | Saved 12 Aug audit basis |
|---|---:|---:|
| QQQI | 1,190 | USD55.20 × 33.254 |
| GOOGL | 40 | USD342.54 × 33.254 |
| META | 20 | USD582.93 × 33.254 |
| CASH | THB39,868.82 | pooled broker cash, no quote request |

The 12 Aug screenshot records WDC sell 22.9782 @ USD440.00 (USD10,108.13
net), GOOGL sell 8 @ USD347.26 (USD2,775.89 net), then GOOGL buys 8 @
USD347.30 and 10 @ USD342.54, plus META buy 20 @ USD582.93. All five are
`Shared-US` pooled trades funded by existing cash. At the approved audit FX
33.254, WDC realizes +THB2,145.88 and the GOOGL sale -THB2,250.48; batch net
is -THB104.59. Workbook totals at the entry-price audit mark are market value
THB3,067,585.66, unrealized P&L -THB14,440.04, cumulative realized P&L
THB512,769.77 and total P&L THB498,329.73. QQQI distribution is excluded from
the forecast until its declared DPS and withholding treatment are verified.

## Superseded pre-pooling state — through 4 Aug 2026, retained for traceability

The canonical `Portfolio_Accounting.xlsx` and embedded seed include the owner
corrections, the available broker-history reconciliation, completed broker
orders through **4 Aug 2026**, including three zero-cash ownership allocations,
one completed Mom AAPL sale and two completed Mom META buys. A public market
refresh may replace the saved
audit marks after canonical import, but must not change units or cost basis.

| Holding | Owner/account | Units | Entry price / audit value |
|---|---|---:|---:|
| GOOGL | Mom | 5 | THB57,628.52 cost (USD1,717.67 / five-share allocation) |
| GOOGL | Rattee | 70 | THB851,302.33 cost (65 prior shares + five-share allocation) |
| META | Mom | 20 | THB376,731.64 cost; latest saved mark USD582.92 × 33.254 |
| META | Rattee | 30 | THB552,250.99 cost (USD16,460.34) |
| AAPL | Mom | 6 | THB60,999.16 cost; saved mark USD306.00 × 33.254 |
| AAPL | Ryu | 14 | THB142,331.36 inherited cost; same saved mark |
| MU | Mom | 13 | THB350,645.77 inherited cost; saved mark THB351,781.43 |
| MU | Ryu | 1 | THB26,972.75 inherited cost; saved mark THB27,060.11 |
| NVDA | Mom | 27 | THB185,766.42 inherited cost; saved mark THB185,838.65 |
| NVDA | Ryu | 18 | THB123,844.28 inherited cost; saved mark THB123,892.43 |
| KBANK | Shared | 630 | THB181.804905 average cost; saved mark THB242.00 |
| CASH | Shared | 1 | THB93,086.66 derived from the confirmed snapshot and exact 4 Aug broker cash flow |

Shared capital remains THB2,155,932.19: Mom 57.9796%, Rattee 28.1053%, and
Ryu 13.9151%. SCB has zero active shares after the 27 Jul 2026 sale. The
THB93,086.66 current free-cash bucket is allocated one third to each owner for
current-equity reporting; KBANK and dividend allocation retain the original
pool percentages. The
canonical total market value is THB2,947,921.44, unrealized P&L is
THB11,824.46, realized P&L is THB366,841.04, and total P&L is
THB378,665.51.

The 3 Aug Mom orders are AAPL buy 50 / sell 15, MU buys 10 @ USD812.00 and
10 @ USD809.80 / sell 6, and NVDA buy 35 plus buy 10. They use the
user-approved USD/THB reference 33.254 and leave AAPL 35, MU 14, and NVDA 45.
Time-bounded formulas record AAPL realized P&L of -THB808.77 and MU realized
P&L of +THB444.67; no future buy is included in a sold cost. The later 4 Aug
internal allocation moves AAPL 14, MU 1 and NVDA 18 from Mom to Ryu at
inherited THB cost **THB293,148.40**. It is not a broker trade, cash flow, new
capital or realized P&L event.

The later 4 Aug completed Mom trades are AAPL sell 15 @ USD306.00 and META
buys 4 @ USD582.92 plus 4 @ USD583.40. Broker totals include fees. At the
same-day approved FX 33.254, net cash outflow is THB2,723.84; AAPL realized
P&L is +THB59.16 and current positions become AAPL Mom 6 and META Mom 20.

### Accounting treatment and live-state gap

Treat the earlier 65-share GOOGL ownership correction as a current-position
correction until a dated internal-transfer record and FX / settlement evidence
are available. Do not invent a Mom sale or realized P&L for that earlier
transfer. The dated U.S. buys reduce Shared CASH after the confirmed SCB gain
removal, but are **not** new external personal capital. GOOGL, META, AAPL, MU,
and NVDA are personal positions and must never change shared-capital
percentages, KBANK ownership, or the dividend forecast.

The 3 Aug seven-order net cash flow is THB1,043,421.73. It would leave a
ledger residual of THB109,163.10, whereas the user-confirmed actual broker
cash snapshot was THB95,810.50 before the later 4 Aug orders. Rolling that
snapshot forward gives THB93,086.66. The THB13,352.60 pre-existing difference is intentionally
an unresolved reconciliation item: do not turn it into profit, new capital,
an owner allocation, or a synthetic transaction without broker evidence.

The pre-pooling production evidence above is historical only. On **8 Aug
2026**, commit `cc02b15` was deployed, `Portfolio_Accounting.xlsx` was
imported into Railway, and `/api/portfolio` verified the 7 Aug canonical state:
one active CASH row at THB3,082,130.2945, 87 parsed ledger rows and cumulative
realized P&L THB512,874.3623946404. The post-import refresh correctly reported
no market mapping because CASH has no quote source. Overview, Shareholders,
Holdings, Dividends, Transactions and Realized Sale P&L were each verified.
Repeat that complete import, public-market refresh, API check and all-six-tab
verification after every future accounting update.

## Canonical Excel workbook

Path: `../Portfolio_Accounting.xlsx`

The workbook must keep exactly these six sheets:

1. `Summary` — formula-driven market value, unrealized/realized P&L and totals.
2. `Shareholders` — total contributed capital and pooled allocation
   percentages, with historical personal-capital metadata retained for audit.
3. `Lot Holdings` — active lots and retained historical lots.
4. `Dividends` — historical paid dividend and the current-capital forecast.
5. `Holdings` — current pooled positions, including pooled `CASH`.
6. `Transactions` — full audit ledger and evidence notes.

### Accounting rules that protect the audit

- `CASH` is a pooled THB row: `Units = 1`, and entry price equals the
  confirmed whole-portfolio broker cash snapshot. It has no quote or dividend
  eligibility, and is not a synthetic balancing transaction.
- SCB is a historical zero-quantity holding after the 27 Jul 2026 sale; retain
  its lots and sell rows for traceability.
- From 5 Aug 2026, every active holding and the aggregate CASH row use one
  Total Contributed Capital allocation: Mom 42.3785%, Rattee 47.4506%, Ryu
  10.1708%. Do not re-create personal active positions unless the user changes
  this policy explicitly.
- The current dividend forecast uses total contributed capital as its yield
  denominator. Past shareholder allocation remains historical evidence only.
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
| `GET /api/market/refresh` | Refresh QQQI/GOOGL/WDC/META/AAPL/NVDA/MU/USDTHB from Google Finance and SCB/KBANK from SET public pages. |
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
- **An active position is split by historic owner units:** stop. Since 5 Aug
  2026, active assets use total-contributed-capital percentages; historic owner
  notes exist only for audit traceability.
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
