import assert from "node:assert/strict";
import test from "node:test";
import * as model from "../app/dashboard/model";
import type { Transaction } from "../app/dashboard/model";

const tx = (date: string, ticker: string, side: string, amount: number): Transaction => ({
  date, ticker, side, account: "Shared-US", order: "Cash credit", quantity: 0,
  priceNative: 0, currency: "USD", grossNative: amount, fx: 33.254,
  costProceedsThb: amount * 33.254 * (side === "WHT_FEE" || side === "FEE" ? -1 : 1),
  realizedPnlThb: 0, note: "Broker cash history 04:00:00",
});

test("pairs received dividends with broker WHT/fees without including sales or interest", () => {
  const derive = (model as unknown as Record<string, unknown>).deriveDividendReceiptHistory;
  assert.equal(typeof derive, "function");
  const result = (derive as (rows: Transaction[]) => {
    rows: Array<{ date: string; ticker: string; grossNative: number; deductionsNative: number; netNative: number; netThb: number }>;
    totalNetThb: number;
  })([
    tx("2026-09-19", "QQQI", "DIVIDEND", 754.34),
    tx("2026-09-19", "QQQI", "WHT_FEE", 113.15),
    tx("2026-09-15", "GOOGL", "DIVIDEND", 8.8),
    tx("2026-09-15", "GOOGL", "WHT_FEE", 1.32),
    tx("2026-10-02", "CASH", "INTEREST", 15.91),
    tx("2026-10-03", "CASH", "FEE", 1),
    tx("2026-10-02", "QQQI", "SELL", 1000),
  ]);
  assert.deepEqual(result.rows.map((row) => [row.date, row.ticker]), [["2026-09-19", "QQQI"], ["2026-09-15", "GOOGL"]]);
  assert.equal(result.rows[0].grossNative, 754.34);
  assert.equal(result.rows[0].deductionsNative, 113.15);
  assert.ok(Math.abs(result.rows[0].netNative - 641.19) < 1e-8);
  assert.ok(Math.abs(result.totalNetThb - (641.19 + 7.48) * 33.254) < 1e-6);
});

test("keeps different broker accounts separate when the same dividend date and ticker repeat", () => {
  const derive = (model as unknown as Record<string, unknown>).deriveDividendReceiptHistory;
  assert.equal(typeof derive, "function");
  const first = tx("2026-09-19", "QQQI", "DIVIDEND", 10);
  const second = { ...first, account: "Rattee-US", grossNative: 20, costProceedsThb: 20 * 33.254 };
  const result = (derive as (rows: Transaction[]) => { rows: unknown[] })([first, second]);
  assert.equal(result.rows.length, 2);
});
