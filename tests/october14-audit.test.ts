import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseWorkbook, deriveSalePnlSummary, deriveDividendReceiptHistory } from "../app/dashboard/model";
async function load() {
  const b = await readFile(new URL("../../Portfolio_Accounting.xlsx", import.meta.url));
  return parseWorkbook(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), "Portfolio_Accounting.xlsx");
}
const close = (a: number, b: number) => assert.ok(Math.abs(a-b) < 0.00001, `${a} != ${b}`);
test("records the twelve newly evidenced Shared executions and four cash events without settlement duplicates", async () => {
  const s = await load();
  const added = s.transactions.slice(180, 196);
  assert.equal(added.length, 16);
  assert.deepEqual(added.filter(t => ["BUY", "SELL"].includes(t.side)).map(t => [t.date,t.ticker,t.side,t.quantity,t.priceNative,t.grossNative]), [
    ["2026-10-12","QQQ","SELL",160.5,746.28,119762.54],
    ["2026-10-12","NVDA","BUY",62,226.01,14017.93],
    ["2026-10-12","NVDA","BUY",20,225.99,4521.93],
    ["2026-10-12","ARM","BUY",37,256.29,9485.90],
    ["2026-10-12","ORCL","BUY",75,137.47,10316.67],
    ["2026-10-12","NVDA","BUY",50,225.76,11292.28],
    ["2026-10-13","QQQ","BUY",82,743.80,60999.03],
    ["2026-10-13","ARM","SELL",17,251.41,4271.75],
    ["2026-10-14","ARM","SELL",20,254.74,5092.56],
    ["2026-10-14","ORCL","BUY",35,143.30,5018.50],
    ["2026-10-14","MU","BUY",13,936.91,12181.96],
    ["2026-10-14","NVDA","BUY",5,227.13,1137.78],
  ]);
  assert.ok(added.every(t => t.account.startsWith("Shared")));
  assert.equal(added.filter(t => t.side === "FEE_REFUND").length,2);
  assert.equal(added.filter(t => t.side === "TRANSFER").length,1);
});
test("separates the QQQ close from its later buy and closes ARM using only its preceding lot cost", async () => {
  const s=await load();const added=s.transactions.slice(180,196);
  const qqqSale=added.find(t=>t.ticker==="QQQ"&&t.side==="SELL");assert.ok(qqqSale,"Expected the new QQQ close");
  close(qqqSale.realizedPnlThb,-100.69*33.254);
  const arm=added.filter(t=>t.ticker==="ARM"&&t.side==="SELL");
  close(arm[0].costProceedsThb-arm[0].realizedPnlThb,9485.90/37*17*33.254);
  close(arm[1].costProceedsThb-arm[1].realizedPnlThb,9485.90/37*20*33.254);
  close(arm.reduce((v,t)=>v+t.realizedPnlThb,0),-121.59*33.254);
  close(s.summary.totalRealizedPnl,747143.6564236404);
  assert.equal(deriveSalePnlSummary(s.transactions,s.shareholders).rows.length,59);
  assert.deepEqual(s.holdings.map(h=>[h.ticker,h.quantity]),[["QQQ",82],["NVDA",174],["ORCL",110],["CASH",1],["MU",13]]);
  for(const[ticker,cost]of [["QQQ",2028461.74362],["NVDA",1305588.67675],["ORCL",509955.74318],["MU",405098.89784]] as const)close(s.holdings.find(h=>h.ticker===ticker)!.costBasis,cost);
});
test("uses the broker cash snapshot and retains verified shareholder capital pending deposit attribution", async () => {
  const s=await load();const added=s.transactions.slice(180,196);
  assert.equal(s.asOfDate,"20 Oct 2026");close(s.holdings.find(h=>h.ticker==="CASH")!.costBasis,493.82461);
  close(s.summary.sharedCapital,3904606.003945636);
  const deposit=added.find(t=>t.side==="TRANSFER")!;close(deposit.grossNative,100);assert.match(deposit.note,/unattributed/i);
  const nonSales=added.filter(t=>!["BUY","SELL"].includes(t.side));assert.ok(nonSales.every(t=>t.realizedPnlThb===0));
  close(nonSales.filter(t=>t.side==="FEE_REFUND").reduce((v,t)=>v+t.costProceedsThb,0),2*33.254);
  close(nonSales.find(t=>t.side==="FEE")!.costProceedsThb,-105.93);
  close(deriveDividendReceiptHistory(s.transactions).totalNetThb,43494.90184);
  assert.equal(added.filter(t=>t.side==="DIVIDEND").length,0);
});
