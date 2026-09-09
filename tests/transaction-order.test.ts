import assert from "node:assert/strict";
import test from "node:test";
import { deriveSalePnlSummary, type Transaction } from "../app/dashboard/model";

test("orders same-day sales by the evidenced execution time without rewriting ledger rows", () => {
  const base: Transaction = {
    date: "2026-09-09", account: "Shared-US", ticker: "INTC", side: "SELL",
    order: "Limit", quantity: 1, priceNative: 100, currency: "USD",
    grossNative: 99, fx: 33.254, costProceedsThb: 3292.146,
    realizedPnlThb: 100, note: "Broker sale on 9 Sep 2026 22:46:00.",
  };
  const ledger = [base, { ...base, ticker: "META", note: "Broker sale on 9 Sep 2026 23:38:20." }];
  const before = structuredClone(ledger);
  const result = deriveSalePnlSummary(ledger, []);
  assert.deepEqual(result.rows.map(row => row.ticker), ["META", "INTC"]);
  assert.deepEqual(ledger, before);
});
