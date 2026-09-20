import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { calculateDashboard, compareTransactionsNewestFirst, createScenario, parseWorkbook } from "../app/dashboard/model";

async function load() {
  const bytes = await readFile(new URL("../../Portfolio_Accounting.xlsx", import.meta.url));
  return parseWorkbook(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "Portfolio_Accounting.xlsx");
}
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 0.00001, `${actual} != ${expected}`);

test("preserves the 108 ledger records audited before the new evidence", async () => {
  const snapshot = await load();
  const old = snapshot.transactions.filter(row => row.date <= "2026-09-09");
  assert.equal(old.length, 108);
  assert.equal(createHash("sha256").update(JSON.stringify(old)).digest("hex"), "d4eaf77f4c9b518229bfd2f181b4d6c0f0b60c004640322271b9943f4450a978");
});

test("keeps the prior September additions and records the new Shared trades", async () => {
  const snapshot = await load();
  assert.equal(snapshot.transactions.length, 125);
  const added = snapshot.transactions.filter(row => row.date > "2026-09-09" && row.date <= "2026-09-15");
  assert.deepEqual(added.map(row => [row.date,row.ticker,row.side,row.quantity,row.priceNative,row.grossNative,row.fx]), [
    ["2026-09-10","AVGO","SELL",6.9162,364.59,2519.38,33.254],
    ["2026-09-10","VOO","BUY",2.1758,701.61,1528.69,33.254],
    ["2026-09-10","GOOGL","BUY",3,330.81,994.56,33.254],
    ["2026-09-15","CASH","TRANSFER",1,300000,300000,1],
    ["2026-09-15","ASML","BUY",5,1589,7947.13,33.254],
    ["2026-09-15","CASH","TRANSFER",1,20000,20000,1],
    ["2026-09-15","ASML","BUY",1,1592.46,1594.59,33.254],
  ]);
  assert.ok(added.every(row => row.account.startsWith("Shared")));
  const deposits = added.filter(row => row.ticker === "CASH");
  assert.ok(deposits.every(row => /Contributor: Mom/.test(row.note)));
  close(deposits.reduce((sum,row)=>sum+row.costProceedsThb,0),320000);
  close(snapshot.shareholders.find(row=>row.owner==="Mom")!.sharedCapital,1870000);
  close(snapshot.shareholders.find(row=>row.owner==="Rattee")!.sharedCapital,1464606.003945636);
  close(snapshot.shareholders.find(row=>row.owner==="Ryu")!.sharedCapital,300000);
});

test("records all ten trades from the 17–19 September evidence as Shared", async () => {
  const snapshot = await load();
  const added = snapshot.transactions.filter(row => row.date >= "2026-09-17");
  assert.deepEqual(added.map(row => [row.date,row.ticker,row.side,row.quantity,row.priceNative,row.grossNative,row.fx]), [
    ["2026-09-17","SPCX","SELL",67,150.75,10094.30,33.254],
    ["2026-09-18","AMAT","BUY",4,418.22,1675.01,33.254],
    ["2026-09-18","KLAC","BUY",50,169.17,8462.78,33.254],
    ["2026-09-19","VOO","SELL",5.7758,701.45,4049.23,33.254],
    ["2026-09-19","CRWV","BUY",50,80.76,4042.28,33.254],
    ["2026-09-19","VOO","SELL",4,701.50,2803.81,33.254],
    ["2026-09-19","AMAT","BUY",6.4,436.74,2797.29,33.254],
    ["2026-09-19","GOOGL","SELL",16,351.50,5621.75,33.254],
    ["2026-09-19","FN","BUY",13,385.98,5019.87,33.254],
    ["2026-09-19","KLAC","BUY",3,173.93,523.92,33.254],
  ]);
  assert.ok(added.every(row => row.account === "Shared-US"));
  close(snapshot.summary.sharedCapital, 3634606.003945636);
});

test("closes AVGO against the pre-sale cost and rolls pooled cash without double-counting exchanges", async () => {
  const snapshot=await load();
  const sale=snapshot.transactions.find(row=>row.date==="2026-09-10"&&row.ticker==="AVGO"&&row.side==="SELL")!;
  close(sale.costProceedsThb,2519.38*33.254);
  close(sale.realizedPnlThb,(2519.38-2697.70)*33.254);
  assert.ok(!snapshot.holdings.some(row=>row.ticker==="AVGO"));
  close(snapshot.holdings.find(row=>row.ticker==="CASH")!.costBasis,4805.78937);
  close(snapshot.holdings.find(row=>row.ticker==="ASML")!.costBasis,9541.72*33.254);
  const result=calculateDashboard(snapshot,createScenario(snapshot));
  close(result.totals.personalMarketValue,0);
  const recent=snapshot.transactions.filter(row=>row.date==="2026-09-15").sort(compareTransactionsNewestFirst);
  assert.deepEqual(recent.map(row=>[row.ticker,row.quantity,row.grossNative]),[["ASML",1,1594.59],["CASH",1,20000],["ASML",5,7947.13],["CASH",1,300000]]);
});
