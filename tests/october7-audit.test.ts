import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deriveDividendReceiptHistory, deriveSalePnlSummary, parseWorkbook } from "../app/dashboard/model";

async function load() {
  const bytes = await readFile(new URL("../../Portfolio_Accounting.xlsx", import.meta.url));
  return parseWorkbook(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "Portfolio_Accounting.xlsx");
}
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 0.00001, `${actual} != ${expected}`);

test("adds only the three 6 October Shared Market executions, not their settlement duplicates", async () => {
  const snapshot = await load();
  assert.equal(snapshot.transactions.length, 180);
  assert.deepEqual(snapshot.transactions.slice(177).map(row => [row.date, row.account, row.ticker, row.side, row.order, row.quantity, row.priceNative, row.grossNative, row.fx]), [
    ["2026-10-06", "Shared-US", "BLK", "SELL", "Market", 5, 1080.04, 5397.95, 33.254],
    ["2026-10-06", "Shared-US", "BLK", "SELL", "Market", 14, 1081.53, 15138.97, 33.254],
    ["2026-10-06", "Shared-US", "QQQ", "BUY", "Market", 27, 762.11, 20579.15, 33.254],
  ]);
  assert.ok(snapshot.transactions.at(-3)!.note.includes("21:36:18"));
  assert.ok(snapshot.transactions.at(-2)!.note.includes("21:58:39"));
  assert.ok(snapshot.transactions.at(-1)!.note.includes("21:59:23"));
  assert.ok(snapshot.transactions.slice(177).every(row => row.note.includes("2026-10-07") && row.note.includes("IMG_4233")));
});

test("closes the two BLK sales against its pre-sale lot including broker charges", async () => {
  const snapshot = await load();
  const sales = snapshot.transactions.slice(177, 179);
  for (const sale of sales) close(sale.costProceedsThb - sale.realizedPnlThb, 20095.58 / 19 * sale.quantity * 33.254);
  close(sales.reduce((total, sale) => total + sale.realizedPnlThb, 0), 441.34 * 33.254);
  close(snapshot.summary.totalRealizedPnl, 754535.3555436408);
  assert.equal(deriveSalePnlSummary(snapshot.transactions, snapshot.shareholders).rows.length, 56);
  assert.deepEqual(snapshot.holdings.map(row => [row.ticker, row.quantity]), [["QQQ", 160.5], ["CASH", 1]]);
  close(snapshot.holdings.find(row => row.ticker === "QQQ")!.costBasis, 119863.23 * 33.254);
});

test("rolls cash from the verified opening snapshot without treating sales as capital or dividends", async () => {
  const snapshot = await load();
  assert.equal(snapshot.asOfDate, "7 Oct 2026");
  close(snapshot.holdings.find(row => row.ticker === "CASH")!.costBasis, 820.3884);
  close(snapshot.summary.sharedCapital, 3634606.003945636);
  assert.ok(snapshot.transactions.slice(177).every(row => ["BUY", "SELL"].includes(row.side)));
  const dividends = deriveDividendReceiptHistory(snapshot.transactions);
  assert.equal(dividends.rows.length, 3);
  close(dividends.totalNetThb, 43494.90184);
});
