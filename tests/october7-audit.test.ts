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
  const additions = snapshot.transactions.slice(177, 180);
  assert.equal(additions.length, 3);
  assert.deepEqual(additions.map(row => [row.date, row.account, row.ticker, row.side, row.order, row.quantity, row.priceNative, row.grossNative, row.fx]), [
    ["2026-10-06", "Shared-US", "BLK", "SELL", "Market", 5, 1080.04, 5397.95, 33.254],
    ["2026-10-06", "Shared-US", "BLK", "SELL", "Market", 14, 1081.53, 15138.97, 33.254],
    ["2026-10-06", "Shared-US", "QQQ", "BUY", "Market", 27, 762.11, 20579.15, 33.254],
  ]);
  assert.ok(additions[0]!.note.includes("21:36:18"));
  assert.ok(additions[1]!.note.includes("21:58:39"));
  assert.ok(additions[2]!.note.includes("21:59:23"));
  assert.ok(additions.every(row => row.note.includes("2026-10-07") && row.note.includes("IMG_4233")));
});

test("closes the two BLK sales against its pre-sale lot including broker charges", async () => {
  const snapshot = await load();
  const sales = snapshot.transactions.slice(177, 179);
  for (const sale of sales) close(sale.costProceedsThb - sale.realizedPnlThb, 20095.58 / 19 * sale.quantity * 33.254);
  close(sales.reduce((total, sale) => total + sale.realizedPnlThb, 0), 441.34 * 33.254);
  const october7Ledger = snapshot.transactions.slice(0, 180);
  assert.equal(deriveSalePnlSummary(october7Ledger, snapshot.shareholders).rows.length, 56);
  close(deriveSalePnlSummary(october7Ledger, snapshot.shareholders).netRealizedPnlThb, 754535.3555436408);
  const tradeUsdChange=snapshot.transactions.slice(177,180)
    .reduce((sum,row)=>sum+(row.side==='BUY'?-row.grossNative:row.grossNative),0);
  close(66.83+tradeUsdChange,24.60);
});

test("rolls cash from the verified opening snapshot without treating sales as capital or dividends", async () => {
  const snapshot = await load();
  assert.equal(snapshot.transactions.slice(177, 180).at(-1)?.date, "2026-10-06");
  const laterUsdChange=snapshot.transactions.slice(180,196)
    .filter(row=>row.currency==='USD')
    .reduce((sum,row)=>sum+(row.side==='BUY'?-row.grossNative:row.grossNative),0);
  const october7Usd=181.47-laterUsdChange;
  close(october7Usd,24.60);
  // The newly evidenced second6Oct deposit corrects the formerly incomplete
  // THB checkpoint: both deposits100+100 less fee105.93 are real cash flows.
  const october6ThbEvents=snapshot.transactions.filter(row=>row.date==='2026-10-06'&&row.currency==='THB'&&row.ticker==='CASH');
  const october7Thb=2.34+october6ThbEvents.reduce((sum,row)=>sum+row.costProceedsThb,0);
  close(october7Thb,96.41);
  close(october7Usd*33.254+october7Thb,914.4584);
  const laterContributions = snapshot.transactions
    .filter(row => row.side === "TRANSFER" && row.date >= "2026-10-14");
  close(snapshot.summary.sharedCapital - laterContributions.reduce((sum,row)=>sum+row.costProceedsThb,0), 3634606.003945636);
  assert.ok(snapshot.transactions.slice(177, 180).every(row => ["BUY", "SELL"].includes(row.side)));
  const dividends = deriveDividendReceiptHistory(snapshot.transactions);
  assert.equal(dividends.rows.length, 3);
  close(dividends.totalNetThb, 43494.90184);
});
