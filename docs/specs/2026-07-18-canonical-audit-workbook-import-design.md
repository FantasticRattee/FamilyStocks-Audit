# Canonical Audit Workbook Import Design

## Goal

Let the dashboard import the canonical six-sheet
`Portfolio_Accounting.xlsx` directly, without removing the existing lightweight
four-column `Holdings` import/export workflow.

## Approved behavior

- A one-sheet workbook named `Holdings` with the four raw columns remains a
  **minimal holdings import**. It replaces only database holdings and preserves
  existing dashboard settings.
- A workbook containing all required audit sheets — `Summary`, `Shareholders`,
  `Lot Holdings`, `Dividends`, `Holdings`, and `Transactions` — is a
  **canonical audit import**.
- Canonical audit import uses the established workbook parser, then atomically
  replaces database holdings and portfolio settings together.
- The imported settings include audit date, default FX, realized-P&L figure,
  shareholder ownership, dividend assumptions, historical dividend record, and
  transaction snapshot.
- Existing live market quotes are retained. Importing an audit never fabricates
  or overwrites a live quote.
- Any parse, validation, password, or database error leaves the prior shared
  PostgreSQL portfolio unchanged.

## Data flow

1. The browser detects whether the chosen XLSX is minimal or canonical.
2. It parses the selected format locally for immediate feedback.
3. The authenticated import request sends normalized holdings and, only for a
   canonical audit, a normalized settings payload.
4. The server validates holdings and settings again.
5. PostgreSQL updates `portfolio_holdings`, optionally updates the singleton
   `portfolio_settings` payload, and appends import metadata in one transaction.
6. The returned shared state drives the dashboard immediately across devices.

## Compatibility and safety

- No database schema migration is needed: canonical settings replace the
  existing JSONB settings payload.
- The minimal export stays deliberately minimal; it is not a replacement for
  the six-sheet accounting workbook.
- Owner/ticker/currency validation remains allow-listed through the existing
  shared-portfolio adapter.
- The UI identifies the two accepted formats so a full audit no longer appears
  as a malformed four-column upload.

## Verification

- Test the supplied canonical audit workbook end-to-end through the parser and
  confirm its 18 Jul 2026 GOOGL state is mapped to Rattee 31 shares.
- Test that minimal imports retain existing settings.
- Test that canonical imports persist the supplied settings atomically with
  holdings and require the Edit Mode password.
- Run unit tests, production build, rendered dashboard checks, and a deployed
  Railway import using the canonical workbook.
