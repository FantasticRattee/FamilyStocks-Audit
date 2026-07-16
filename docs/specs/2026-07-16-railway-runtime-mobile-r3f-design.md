# Railway Runtime + Mobile Hero/R3F Design

**Status:** implemented and regression-verified<br>
**Date:** 16 Jul 2026<br>
**Decision:** use one platform-neutral server environment adapter so the same
Worker routes run on Cloudflare-style runtimes and Railway's Node production
runtime. Keep the dashboard stateless on the server; no database is required.

## Goals

1. Make Edit Mode password verification work under `vinext start` on Railway.
2. Make OpenAI-only market refresh read its secret under Railway without
   exposing it to browser JavaScript.
3. Fill the complete mobile hero artwork area without the blank right-side
   strip shown at 393 x 852.
4. Keep portfolio composition interactive on touch devices. Use real R3F when
   WebGL is available and an interactive visual fallback when it is not.
5. Preserve Excel as the audit source and keep all live-price changes
   display-only.

## Non-goals

- No database, user table, session store, or server-side workbook storage.
- No change to `Portfolio_Accounting.xlsx`, its formulas, or ownership logic.
- No return to alternate market-price providers. Public refresh remains
  OpenAI-only.
- No automatic market-price timer.

## Runtime architecture

Add a small, pure runtime-environment boundary used by `worker/index.ts`.

1. Read only the approved server variables:
   `EDIT_MODE_PASSWORD`, `OPENAI_API_KEY`, and `OPENAI_MARKET_MODEL`.
2. Prefer values supplied by the Worker runtime.
3. If the Worker `env` object is absent, read the same allow-listed names from
   Node `process.env` for Railway.
4. Never serialize these values into an API response, client component, log,
   URL, IndexedDB record, or exported workbook.

This fixes the reproduced production failure where `vinext start` invokes
`worker.fetch` with `env === undefined` and the current code throws before it
can verify a password.

### API behavior

- `POST /api/edit-auth`
  - missing configured password: `503`
  - incorrect password: `401`
  - correct password: `200 { authenticated: true }`
- `GET /api/market/refresh`
  - configured OpenAI key: one sourced Responses API web-search request
  - missing/failed key or quote: retain the imported Excel price/FX and report
    a per-key failure

## Railway configuration

The Railway production service must define:

```text
EDIT_MODE_PASSWORD=<new production password>
OPENAI_API_KEY=<new OpenAI API key>
OPENAI_MARKET_MODEL=gpt-5.6
```

`OPENAI_MARKET_MODEL` remains optional. Railway variable changes must be
deployed/redeployed before the running service receives them. Local `.dev.vars`
remains ignored and is not uploaded to Railway or GitHub.

## Mobile hero

At narrow phone widths:

- keep `.wealth-hero-primary` as a full-width, fixed-height visual stage;
- make `.wealth-hero-artwork` and its image fill the complete stage with
  `inset: 0`, `width: 100%`, `height: 100%`, and `object-fit: cover`;
- choose a mobile `object-position` that keeps all three family members visible;
- use a full-stage gradient overlay for text contrast instead of reserving a
  blank column;
- keep the value, P&L chip, and as-of date inside a safe copy area without
  changing the stats cards below.

Acceptance at 393 x 852 and 320 x 568: no unpainted right strip, no horizontal
page overflow, and no clipped portfolio value.

## Mobile R3F composition

- Keep the current React 19 / R3F 9 / drei 10 version pairing.
- Keep a real `<Canvas>` at mobile breakpoints; do not replace it with a static
  chart merely because the viewport is narrow.
- Preserve mesh `onClick` selection and the exact-value buttons. A tap updates
  the active ticker/value state.
- Give the stage an explicit mobile height and touch behavior that allows page
  scrolling while preserving taps.
- Replace the text-only `3D preview unavailable` branch with the existing
  allocation ring rendered as an accessible button when WebGL initialization
  truly fails. Tapping that fallback cycles/selects portfolio allocations, so
  the component remains useful even in an in-app browser without WebGL.
- Keep demand rendering and reduced-motion behavior; no React state updates
  inside `useFrame`.

## Testing plan

Follow red-green-refactor:

1. Add a failing runtime test that invokes the built Worker with an undefined
   Worker env and Node-style variables. It must prove Edit Mode returns 401/200
   instead of throwing HTTP 500 and that the OpenAI key is resolved server-side.
2. Add failing source/render assertions for the full-width mobile hero and the
   interactive no-WebGL allocation fallback.
3. Implement the runtime adapter and responsive/R3F changes.
4. Run targeted tests, all TypeScript tests, rendered HTML checks, build, and
   lint.
5. Start `vinext start` with non-secret diagnostic variables and smoke-test
   `/api/edit-auth` in production mode.
6. Inspect a 393 x 852 viewport and verify tap selection, image coverage, and
   no horizontal overflow.

## Documentation and dependency sync

Update:

- `README.md` with Railway variables and redeploy instructions;
- the mobile responsive and OpenAI refresh specs with Railway parity notes;
- root `DEPENDENCIES.md` with the runtime-env boundary;
- root `Handoff.md` with production deployment behavior.

No workbook regeneration or accounting-document change is required.

## Acceptance criteria

- Railway production no longer returns HTTP 500 from `/api/edit-auth` because
  the Worker env is absent.
- A configured production password unlocks Edit Mode; no database is involved.
- A configured production OpenAI key powers Refresh market prices; no alternate
  provider is called.
- The mobile hero image fills the complete hero stage.
- R3F remains interactive on WebGL-capable mobile browsers, and a clickable
  allocation fallback replaces the unavailable message elsewhere.
- All regression checks pass and no secret is committed.

## Verification result

- Built production output and ran it through `vinext start` with non-secret
  diagnostic Node variables.
- `POST /api/edit-auth` returned 401 for an incorrect password and 200 for the
  configured diagnostic password; the previous undefined-env HTTP 500 is gone.
- Automated market-route coverage proved that an undefined Worker env resolves
  the Railway `OPENAI_API_KEY` and passes it only in server-side authorization.
- Rendered/source checks pin the full-width phone hero, `pan-y` canvas touch
  behavior, and clickable no-WebGL allocation ring.
- Headless Chrome at 393 x 852 measured `scrollWidth === innerWidth === 393`.
  Tapping the real blue R3F segment changed the active allocation from SCB to
  GOOGL; with WebGL disabled, tapping the fallback ring made the same change.
- `npm test` passed 18/18, TypeScript suites passed 24/24, and lint completed
  with zero errors.
