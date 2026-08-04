# Shareholder Matrix Transpose

Date: 5 Aug 2026
Status: Approved by the owner

## Goal

Make the Shareholders page easier to compare without a nine-column horizontal
scroll. Preserve every accounting value and transpose only the presentation:
owners become columns and metrics become rows.

## Approved layout

The matrix header is `Metric | Mom | Ryu | Rattee`. Its rows are:

1. Shared Capital · Fixed
2. % Pool
3. Free Cash %
4. External Personal Capital
5. Owner-specific Holdings
6. Total Invested
7. Est. Current Equity
8. P&L vs Invested

Currency and percentage formatting remain unchanged. P&L retains the existing
positive, negative and neutral color classes. The first column is a semantic
row header; owner names are semantic column headers.

## Responsive behavior

At the current tablet-width dashboard the four-column matrix fits without
horizontal scrolling. At phone widths the matrix keeps the same orientation,
uses compact spacing and allows metric labels to wrap. Values remain complete;
they are not abbreviated or rounded beyond the existing formatters.

## Boundaries

This is a presentation-only change. It does not change Excel, Railway
PostgreSQL, portfolio calculations, ownership percentages, dividend logic,
imports, exports or market prices.

## Verification

- Rendered/source regression test proves owners are column headers and metrics
  are row headers.
- Existing accounting tests remain unchanged and pass.
- Typecheck, lint, production build and rendered-runtime tests pass.
- Production Shareholders page is checked after the Railway release succeeds.
