import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {parseWorkbook,deriveSalePnlSummary,deriveDividendReceiptHistory} from '../app/dashboard/model';
async function load(){const b=await readFile(new URL('../../Portfolio_Accounting.xlsx',import.meta.url));return parseWorkbook(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'Portfolio_Accounting.xlsx');}
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);
test('adds only the confirmed contributor capital and reallocates all pooled assets',async()=>{
  const s=await load();assert.equal(s.asOfDate,'20 Oct 2026');
  close(s.summary.sharedCapital,3904606.003945636);
  for(const[owner,capital]of [['Mom',1870000],['Ryu',400000],['Rattee',1634606.003945636]] as const){
    const h=s.shareholders.find(x=>x.owner===owner)!;assert.ok(h);close(h.sharedCapital,capital);close(h.poolPercent,capital/3904606.003945636);
  }
  assert.ok(s.holdings.every(h=>h.category==='shared'));
});
test('preserves old lot THB costs and applies actual FX only to the new NVDA lot',async()=>{
  const s=await load();close(s.defaultFx,33.687);
  assert.deepEqual(s.holdings.map(h=>[h.ticker,h.quantity]),[['QQQ',82],['NVDA',174],['ORCL',110],['CASH',1],['MU',13]]);
  for(const[ticker,cost]of [['QQQ',60999.03*33.254],['NVDA',1305588.67675],['ORCL',15335.17*33.254],['MU',12181.96*33.254]] as const)close(s.holdings.find(h=>h.ticker===ticker)!.costBasis,cost);
  close(s.holdings.find(h=>h.ticker==='CASH')!.costBasis,493.82461);
});
test('retains the entire old ledger and adds only the missing deposit, new deposits and NVDA buy',async()=>{
  const s=await load();assert.equal(s.transactions.length,200);
  assert.equal(createHash('sha256').update(JSON.stringify(s.transactions.slice(0,196))).digest('hex'),'19bb2737b22ec74461ba4163812bb90678bd182f63d552afecbe32a4f68dc82d');
  const added=s.transactions.slice(196);assert.ok(added.every(t=>t.account.startsWith('Shared')));
  const buys=added.filter(t=>t.side==='BUY');assert.equal(buys.length,1);
  assert.deepEqual([buys[0].date,buys[0].ticker,buys[0].quantity,buys[0].priceNative,buys[0].grossNative,buys[0].fx],['2026-10-15','NVDA',37,221.12,8184.61,33.687]);
  assert.match(added[0].note,/22:10:21/);assert.match(added[0].note,/unattributed/i);close(added[0].grossNative,100);
  close(added.filter(t=>t.currency==='THB').reduce((v,t)=>v+t.costProceedsThb,0),270100);
  assert.equal(added.filter(t=>t.side==='TRANSFER').length,3);
  close(181.47+8015.17-buys[0].grossNative,12.03);
  close(96.41+250000+20000-270007.84,88.57);
});
test('cash funding and FX movements do not become sales or dividend income',async()=>{
  const s=await load();close(s.summary.totalRealizedPnl,747143.6564236407);
  assert.equal(deriveSalePnlSummary(s.transactions,s.shareholders).rows.length,59);
  assert.ok(s.transactions.slice(196).every(t=>t.realizedPnlThb===0));
  close(deriveDividendReceiptHistory(s.transactions).totalNetThb,43494.90184);
});
