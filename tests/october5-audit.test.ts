import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deriveDividendReceiptHistory, deriveSalePnlSummary, parseWorkbook } from "../app/dashboard/model";

async function load() {
  const bytes = await readFile(new URL("../../Portfolio_Accounting.xlsx", import.meta.url));
  return parseWorkbook(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "Portfolio_Accounting.xlsx");
}
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 0.00001, `${actual} != ${expected}`);

test("records all 21 new Shared trades from the September/October broker evidence without duplicates", async () => {
  const snapshot = await load();
  const added = snapshot.transactions.slice(144).filter(row => ["BUY", "SELL"].includes(row.side));
  assert.deepEqual(added.map(row => [row.date, row.ticker, row.side, row.quantity, row.priceNative, row.grossNative]), [
    ["2026-09-29", "MU", "BUY", 5, 1078.45, 5394.38],
    ["2026-09-29", "MU", "BUY", 4, 1071, 4286.13],
    ["2026-09-30", "MU", "BUY", 18, 1071.82, 19294.89],
    ["2026-09-30", "GOOGL", "BUY", 3, 349.64, 1051.05],
    ["2026-10-01", "AMZN", "SELL", 61, 250.02, 15245.68],
    ["2026-10-01", "AVGO", "BUY", 15, 353.61, 5306.28],
    ["2026-10-01", "MU", "BUY", 9, 1067.62, 9610.71],
    ["2026-10-01", "MU", "SELL", 35, 1054.17, 36892.18],
    ["2026-10-01", "BLK", "BUY", 19, 1057.55, 20095.58],
    ["2026-10-01", "NVDA", "SELL", 80, 230.4, 18424.77],
    ["2026-10-02", "QQQ", "BUY", 48, 738.5, 35451.97],
    ["2026-10-02", "SPCX", "SELL", 74.7628, 150.16, 11219.90],
    ["2026-10-02", "MU", "SELL", 17, 1085, 18442.49],
    ["2026-10-02", "VOO", "BUY", 42.38, 702.7, 29784.01],
    ["2026-10-02", "VOO", "SELL", 42.38, 702.8, 29780.55],
    ["2026-10-02", "QQQ", "BUY", 40, 742.76, 29713.82],
    ["2026-10-02", "AVGO", "SELL", 50, 353.6, 17675.35],
    ["2026-10-02", "SNDK", "BUY", 10, 1714.82, 17150.33],
    ["2026-10-02", "SNDK", "SELL", 10, 1716.19, 17159.41],
    ["2026-10-02", "GOOGL", "SELL", 48, 342.04, 16413.49],
    ["2026-10-02", "QQQ", "BUY", 45.5, 749.77, 34118.29],
  ]);
  assert.ok(added.every(row => row.account === "Shared-US" && row.fx === 33.254));
  assert.equal(new Set(added.map(row => `${row.date}/${row.ticker}/${row.side}/${row.quantity}/${row.grossNative}`)).size, 21);
  close(added.filter(row => row.side === "BUY").reduce((sum, row) => sum + row.grossNative, 0), 211257.44);
  close(added.filter(row => row.side === "SELL").reduce((sum, row) => sum + row.grossNative, 0), 181253.82);
});

test("uses MU's pre-sale weighted cost and preserves the closed VOO/SNDK round trips", async () => {
  const snapshot = await load();
  const sales = snapshot.transactions.slice(144).filter(row => row.side === "SELL");
  const mu = sales.filter(row => row.ticker === "MU");
  close(mu[0].costProceedsThb - mu[0].realizedPnlThb, 55780.74 / 52 * 35 * 33.254);
  close(mu[1].costProceedsThb - mu[1].realizedPnlThb, 55780.74 / 52 * 17 * 33.254);
  close(mu.reduce((sum, row) => sum + row.realizedPnlThb, 0), -446.07 * 33.254);
  close(sales.find(row => row.ticker === "VOO")!.realizedPnlThb, -3.46 * 33.254);
  close(sales.find(row => row.ticker === "SNDK")!.realizedPnlThb, 9.08 * 33.254);
  close(sales.reduce((sum, row) => sum + row.realizedPnlThb, 0), 544.34 * 33.254);
  close(snapshot.holdings.find(row => row.ticker === "QQQ")!.costBasis, 99284.08 * 33.254);
  close(snapshot.holdings.find(row => row.ticker === "BLK")!.costBasis, 20095.58 * 33.254);
  assert.deepEqual(snapshot.holdings.map(row => [row.ticker, row.quantity]), [["QQQ", 133.5], ["BLK", 19], ["CASH", 1]]);
});

test("separates cash income from sale P&L, keeps capital unchanged, and uses evidenced cash", async () => {
  const snapshot = await load();
  const events = snapshot.transactions.slice(144).filter(row => !["BUY", "SELL"].includes(row.side));
  assert.equal(events.length, 12);
  assert.ok(events.every(row => row.realizedPnlThb === 0 && row.quantity === 0 && row.account === "Shared-US"));
  assert.ok(snapshot.transactions.filter(row => row.side === "TRANSFER").every(row => row.date <= "2026-09-15"));
  close(snapshot.summary.sharedCapital, 3634606.003945636);
  close(snapshot.holdings.find(row => row.ticker === "CASH")!.costBasis, 66.83 * 33.254 + 2.34);
  const receipts = deriveDividendReceiptHistory(snapshot.transactions);
  assert.deepEqual(receipts.rows.map(row => [row.date, row.ticker, row.netNative]), [
    ["2026-09-19", "QQQI", 641.19], ["2026-09-15", "GOOGL", 7.48], ["2026-08-22", "QQQI", 659.29],
  ]);
  close(receipts.totalNetThb, 43494.90184);
  const history = deriveSalePnlSummary(snapshot.transactions, snapshot.shareholders);
  assert.equal(history.rows.length, 54);
  close(snapshot.summary.totalRealizedPnl, 739859.0351836405);
});
