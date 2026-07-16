# Dashboard change-impact map

Created: 2026-07-16. Use this file with the `impact-check` skill before changing runtime, market-data, workbook, or presentation behavior.

## Artifact inventory

- **Live app/service (canonical):** `app/`, `worker/index.ts`, `vite.config.ts`, and `package.json`; deployed from GitHub `main` to Railway.
- **Embedded audit source (canonical snapshot):** `app/dashboard/initial-workbook.ts`, generated from `../Portfolio_Accounting.xlsx`.
- **Workbook parser/calculator:** `app/dashboard/model.ts`.
- **Browser workbook persistence:** `app/dashboard/persisted-workbook.ts`; stores the last validated imported workbook in IndexedDB.
- **Edit/export workflow:** `app/dashboard/edit-model.ts`, `app/dashboard/workbook-export.ts`, and `app/dashboard/edit-auth.ts`.
- **Market refresh workflow:** `app/dashboard/market-api.ts`, `app/dashboard/live-market.ts`, `worker/index.ts`, and the UI in `app/dashboard/Dashboard.tsx`.
- **3D and responsive presentation:** `app/dashboard/Dashboard.tsx`, `app/globals.css`, `public/family-portfolio-hero.png`.
- **Canonical operator documentation:** `README.md`.
- **Design records:** `docs/specs/2026-07-16-mobile-responsive-dashboard-design.md` and `docs/specs/2026-07-16-railway-runtime-mobile-r3f-design.md`.
- **Automated verification:** `tests/*.test.ts` and `tests/rendered-html.test.mjs`.
- **Diagrams and exported document figures:** none currently tracked.

## Impact matrix

| If you change… | Code files | Diagram(s) to update + re-export | Doc figure(s) to re-export | Doc section(s) to edit | Also sync |
|---|---|---|---|---|---|
| OpenAI market lookup, quote parsing, retry policy, source requirements, or provider text | `app/dashboard/market-api.ts`, `worker/index.ts`, `tests/market-api.test.ts`, `tests/rendered-html.test.mjs` | None | None | `README.md` “Refresh market prices” and “Configure OpenAI web search”; `docs/specs/2026-07-16-railway-runtime-mobile-r3f-design.md` market route/verification sections | Confirm `OPENAI_API_KEY` / optional model variables in Railway; verify `/api/market/refresh` and the real UI button in production |
| Mapping a workbook ticker to a market key or currency | `app/dashboard/live-market.ts`, `app/dashboard/market-api.ts`, `tests/live-market.test.ts`, `tests/market-api.test.ts` | None | None | `README.md` market source/limitations | Keep workbook ticker/currency assumptions in `model.ts` and Edit Mode export behavior aligned |
| Applying live prices or FX to dashboard calculations | `app/dashboard/live-market.ts`, `app/dashboard/model.ts`, `app/dashboard/Dashboard.tsx`, `tests/live-market.test.ts`, `tests/dashboard-model.test.ts` | None | None | `README.md` display-only/audit separation | Do not mutate imported workbook bytes, transactions, cost basis, or exported Excel unless explicitly requested |
| Workbook schema, parsing, formulas, shareholder labels, or source snapshot | `app/dashboard/model.ts`, `app/dashboard/initial-workbook.ts`, `app/dashboard/Dashboard.tsx`, relevant workbook tests | None | None | `README.md` import/persistence/accounting notes | Regenerate embedded workbook snapshot; reconcile `../Portfolio_Accounting.xlsx`; test imported-workbook persistence |
| Edit Mode authentication or Railway secret resolution | `app/dashboard/edit-auth.ts`, `worker/index.ts`, `app/dashboard/Dashboard.tsx`, `tests/rendered-html.test.mjs` | None | None | `README.md` Edit Mode and Railway deployment; Railway runtime design spec | Set masked `EDIT_MODE_PASSWORD` in Railway and validate wrong=401/correct=200 |
| Excel edit/export behavior | `app/dashboard/edit-model.ts`, `app/dashboard/workbook-export.ts`, `app/dashboard/Dashboard.tsx`, workbook/edit tests | None | None | `README.md` “Edit and export Excel” | Preserve the original imported workbook; validate generated workbook formulas and audit sheet |
| Mobile hero, R3F, 3D bars, or responsive layout | `app/dashboard/Dashboard.tsx`, `app/globals.css`, `public/family-portfolio-hero.png`, `tests/rendered-html.test.mjs` | None | None | Both responsive/R3F design specs and README mobile section | Validate 393×852 and desktop; confirm R3F canvas-ready and touch/click selection |
| Dev/start port or Railway process behavior | `package.json`, `vite.config.ts`, `worker/index.ts` | None | None | `README.md` local run and Railway deployment | Keep local dev on one explicit port; production must honor Railway `PORT` |

## Internal code graph

- `worker/index.ts` → routes Edit Auth to `edit-auth.ts`, market endpoints to `market-api.ts`, then all other requests to vinext. Runtime-secret resolution here affects both Railway and Cloudflare-style execution.
- `Dashboard.tsx` → loads `initial-workbook.ts` → parses via `model.ts` → overlays display-only data via `live-market.ts` → renders all financial cards and 3D charts.
- `Dashboard.tsx` → `/api/market/refresh` → `worker/index.ts` → `market-api.ts` → OpenAI Responses API → `live-market.ts` validation → `model.ts` calculation.
- `Dashboard.tsx` → `persisted-workbook.ts` for the active browser workbook; a newly imported valid workbook replaces the previous browser copy.
- `Dashboard.tsx` → `edit-model.ts` → `workbook-export.ts`; this path deliberately writes a new downloadable workbook and does not alter the imported source bytes.
- High-fan-in hubs: `Dashboard.tsx` (UI orchestration), `model.ts` (accounting model), `worker/index.ts` (runtime routing/secrets), and `market-api.ts` (external quote contract).

## Data-contract ripple

- `/api/market/refresh` returns `{ quotes, failures, fetchedAt, provider?, sources? }`. Any shape change must update `MarketRefreshPayload` in `market-api.ts`, `LiveMarketBatchResponse` in `live-market.ts`, the fetch handler/status text in `Dashboard.tsx`, and both market test files.
- A quote must carry `symbol`, positive numeric `price`, expected `currency`, `exchange`, `marketState`, and timestamp/source metadata. Currency validation happens again in `live-market.ts` before calculation.
- Runtime secret changes must be reflected in the `Env` and `RuntimeSecret` types in `worker/index.ts`, `.dev.vars.example`, README deployment instructions, and Railway service variables.
- Workbook schema changes ripple through `parseWorkbook`, scenario creation, dashboard calculations, browser persistence, edit/export generation, the embedded workbook snapshot, and workbook fixtures.

## Known sync debts

- The public refresh is a sourced OpenAI web lookup rather than a licensed exchange feed; missing or ambiguous search results intentionally retain audit prices.
- `market-api.ts` still exposes legacy Yahoo search/quote endpoints for Edit Mode even though the public Refresh button is OpenAI-only. Provider copy must not imply Yahoo powers the public refresh.
- The Railway service variables are deployment state and are not represented in Git; a fresh Railway service requires manual secret configuration.
- Live market prices are intentionally display-only and are not persisted to IndexedDB or written back to Excel by the Refresh button.
