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
  assert.equal(snapshot.transactions.length, 144);
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

test("records all eighteen trades from the 17–22 September evidence as Shared", async () => {
  const snapshot = await load();
  const added = snapshot.transactions.filter(row => row.date >= "2026-09-17" && row.date <= "2026-09-22");
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
    ["2026-09-21","CRWV","SELL",50,83.69,4180,33.254],
    ["2026-09-21","AMAT","SELL",10.4,454.92,4728.79,33.254],
    ["2026-09-21","FN","SELL",13,395.72,5141.96,33.254],
    ["2026-09-21","KLAC","SELL",53,181.32,9604.91,33.254],
    ["2026-09-21","ASML","SELL",6,1695,10167.33,33.254],
    ["2026-09-22","VOO","SELL",11,712.7,7837.15,33.254],
    ["2026-09-22","QQQI","SELL",1190,55.46,65897.95,33.254],
    ["2026-09-22","GOOGL","SELL",30,355.72,10668.46,33.254],
  ]);
  assert.ok(added.every(row => row.account === "Shared-US"));
  close(snapshot.summary.sharedCapital, 3634606.003945636);
});

test("records the eleven Shared trades from the 24–29 September evidence without changing capital", async () => {
  const snapshot = await load();
  const added = snapshot.transactions.filter(row => row.date >= "2026-09-24");
  assert.deepEqual(added.map(row => [row.date,row.ticker,row.side,row.quantity,row.priceNative,row.grossNative,row.fx]), [
    ["2026-09-24","GOOGL","BUY",45,338.8,15249.85,33.254],
    ["2026-09-24","AMZN","BUY",61,246.41,15036.4,33.254],
    ["2026-09-25","AVGO","BUY",35,349.91,12249.85,33.254],
    ["2026-09-25","MU","BUY",7,1078,7548.13,33.254],
    ["2026-09-25","NVDA","BUY",80,224.9,17998.85,33.254],
    ["2026-09-25","SPCX","BUY",68,148.55,10107.22,33.254],
    ["2026-09-26","HPQ","BUY",235,31.53,7429.67,33.254],
    ["2026-09-28","HPQ","SELL",235,31.3,7335.22,33.254],
    ["2026-09-28","MU","BUY",5,1073.56,5369.93,33.254],
    ["2026-09-28","MU","BUY",4,1068.61,4276.57,33.254],
    ["2026-09-29","SPCX","BUY",6.7628,146.8,994.9,33.254],
  ]);
  assert.ok(added.every(row => row.account === "Shared-US"));
  assert.ok(added.every(row => row.order === "Limit"));
  close(added.find(row => row.ticker === "HPQ" && row.side === "SELL")!.realizedPnlThb, -3140.8403);
  close(snapshot.summary.sharedCapital, 3634606.003945636);
});

test("closes AVGO against the pre-sale cost and rolls pooled cash without double-counting exchanges", async () => {
  const snapshot=await load();
  const sale=snapshot.transactions.find(row=>row.date==="2026-09-10"&&row.ticker==="AVGO"&&row.side==="SELL")!;
  close(sale.costProceedsThb,2519.38*33.254);
  close(sale.realizedPnlThb,(2519.38-2697.70)*33.254);
  const avgo=snapshot.holdings.filter(row=>row.ticker==="AVGO");
  assert.equal(avgo.length,1);
  assert.equal(avgo[0].quantity,35);
  close(avgo[0].costBasis,12249.85*33.254);
  close(snapshot.holdings.find(row=>row.ticker==="CASH")!.costBasis,979161.29097);
  assert.deepEqual(snapshot.holdings.map(row=>row.ticker), ["GOOGL","AMZN","AVGO","CASH","MU","NVDA","SPCX"]);
  const result=calculateDashboard(snapshot,createScenario(snapshot));
  close(result.totals.personalMarketValue,0);
  const recent=snapshot.transactions.filter(row=>row.date==="2026-09-15").sort(compareTransactionsNewestFirst);
  assert.deepEqual(recent.map(row=>[row.ticker,row.quantity,row.grossNative]),[["ASML",1,1594.59],["CASH",1,20000],["ASML",5,7947.13],["CASH",1,300000]]);
});
