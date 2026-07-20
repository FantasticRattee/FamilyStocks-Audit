# Free Public Market Sources

Date: 20 Jul 2026

## Goal

Remove the OpenAI Responses API from the public market-price refresh flow while
keeping the shared PostgreSQL portfolio, audit cost basis, and Edit Mode
behavior unchanged.

## Approved source boundary

- `GOOGL` and `USDTHB` use the public Google Finance quote pages.
- `SCB` and `KBANK` use the official public SET quote pages.
- Yahoo Finance remains available only for the existing Edit Mode search and
  manual quote workflow. It is not a source for the public dashboard refresh.

These are public web-page parsers, not licensed real-time exchange feeds. The
parser allow-lists each expected symbol, currency, exchange, and source URL so
an unrelated page value cannot update the shared portfolio.

## Refresh behavior

1. Every click on `Refresh market prices` makes one fresh request for each of
   the four configured keys; there is no shared cooldown and no OpenAI usage.
2. Each successful parsed quote is upserted into PostgreSQL with its source
   link and fetch time.
3. A failed key never overwrites its previous persisted quote. The response
   identifies it as retained and explains the source failure in the UI.
4. The response is `no-store`; the browser receives the actual refresh result.

## UI behavior

- The dashboard status identifies `Google Finance + SET public quotes` and
  shows refreshed versus retained values.
- The dividend distribution returns to accessible, straight CSS progress bars.
  Ownership and P&L retain their existing compact R3F bar fields.

## Security and deployment

- Remove `OPENAI_API_KEY` and `OPENAI_MARKET_MODEL` from Worker environment
  resolution, local examples, docs, and Railway after deployment.
- Keep `DATABASE_URL` and `EDIT_MODE_PASSWORD` server-only.
- Update the dependency map and regression coverage before deploying.

## Verification

1. Unit fixtures prove Google Finance and SET pages parse only their configured
   keys and that a refresh performs no OpenAI call or cooldown lookup.
2. Partial failures retain previous database values.
3. Render checks prove the dividend chart contains standard progress bars and
   no dividend R3F canvas, while ownership and P&L remain 3D.
4. Production refresh persists fresh price timestamps and source links.
