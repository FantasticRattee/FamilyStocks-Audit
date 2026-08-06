# Sale P&L Ledger Tab — Design

**Approved:** 7 Aug 2026
**Scope:** Dashboard-only derived view. The canonical workbook, import payload,
PostgreSQL schema, and raw transaction ledger remain unchanged.

## Goal

Make it obvious which sale dates made or lost money, and show Rattee's share
of each post-pooling sale without reinterpreting historical owner records.

## User experience

Add a sixth navigation tab, **กำไรขาย** (Sale P&L), after `รายการ`.

The tab has two layers:

1. A compact summary: total realized gains, total realized losses, and net
   realized P&L across all `SELL` transactions in the imported ledger.
2. A newest-first table of every `SELL` row, grouped visually by date. It
   shows date, ticker, net proceeds, sold cost, realized P&L, and the Rattee
   allocation where it is deterministic.

`TRANSFER` rows are excluded: they are not broker sales and have no realized
P&L. `BUY` rows are excluded because they do not realize a gain/loss.

## Allocation rule

- Transactions dated **5 Aug 2026 or later** are pooled. `Rattee share` equals
  `realizedPnlThb × Rattee's current Total Contributed Capital percentage`
  (47.450608727857474% in the current audit).
- Earlier transactions remain historical ledger evidence. Their Rattee share
  is intentionally shown as `Historical` rather than applying the new pooled
  percentage backward in time.
- The table always preserves the whole-portfolio realized P&L, so a historical
  row can still be audited even if no current allocation is displayed.

## Data flow and calculations

The screen derives a `SalePnlRow` from `TransactionSettings.transactions` in
the same client-side model already used by the Transactions tab:

- keep only `side === "SELL"`;
- `netProceedsThb = costProceedsThb`;
- `soldCostThb = netProceedsThb - realizedPnlThb`;
- `classification = gain | loss | flat` from `realizedPnlThb`;
- sort by ISO date descending, retaining same-day ledger order;
- compute summary totals from positive and negative realized P&L separately.

No new account value, market quote, dividend calculation, or workbook formula
is introduced.

## Verification

- Unit tests prove filtering, newest-first ordering, sold-cost math,
  gain/loss totals, and post-5-Aug Rattee allocation.
- Rendered dashboard test verifies the new tab and the expected visible labels.
- Existing full test, typecheck, lint, and production deployment checks must
  still pass.
