import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import XLSX from "xlsx";

import {
  isYahooCandidateCurrencyCompatible,
  parseYahooChartQuote,
  parseYahooSearch,
} from "../app/dashboard/market-data";
import {
  exportEditedWorkbook,
  type WorkbookEditRequest,
} from "../app/dashboard/workbook-export";

const sourceWorkbook = new URL(
  "../../Portfolio_Accounting.xlsx",
  import.meta.url,
);

const readSourceWorkbook = async () => {
  const file = await readFile(sourceWorkbook);
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
};

const sourceHoldings = [
  { ticker: "GOOGL", currency: "USD" as const },
  { ticker: "SCB", currency: "THB" as const },
  { ticker: "KBANK", currency: "THB" as const },
];

const baseRequest = (): WorkbookEditRequest => ({
  sourceWorkbook: "Portfolio_Accounting.xlsx",
  exportedAt: "2026-07-15T10:30:00.000Z",
  holdings: sourceHoldings,
  renames: [],
  priceUpdates: [],
  dividendUpdates: [],
});

const countFormulas = (workbook: XLSX.WorkBook) =>
  workbook.SheetNames.reduce(
    (count, sheetName) =>
      count +
      Object.values(workbook.Sheets[sheetName]).filter(
        (cell) => cell && typeof cell === "object" && "f" in cell,
      ).length,
    0,
  );

test("exports a global ticker rename and USD quote without corrupting workbook formulas", async () => {
  const source = await readSourceWorkbook();
  const original = XLSX.read(source, {
    type: "array",
    cellFormula: true,
    cellStyles: true,
  });
  const request = baseRequest();
  request.renames = [{ from: "GOOGL", to: "GOOGL.NEW" }];
  request.priceUpdates = [
    {
      ticker: "GOOGL",
      priceNative: 333.25,
      currency: "USD",
      fx: 33,
      source: "Yahoo Finance",
      yahooSymbol: "GOOGL.NEW",
      companyName: "Alphabet Test Inc",
      quoteTimestamp: "2026-07-15T10:29:00.000Z",
    },
  ];

  const exported = exportEditedWorkbook(source, request);
  const workbook = XLSX.read(exported.bytes, {
    type: "array",
    cellFormula: true,
    cellStyles: true,
  });

  assert.equal(workbook.Sheets.Transactions.C50?.v, "GOOGL.NEW");
  assert.equal(workbook.Sheets.Transactions.C51?.v, "GOOGL.NEW");
  assert.equal(workbook.Sheets.Holdings.A10?.v, "GOOGL.NEW");
  assert.equal(workbook.Sheets.Holdings.A11?.v, "GOOGL.NEW");
  assert.equal(workbook.Sheets.Summary.B30?.v, "GOOGL.NEW (Alphabet Inc)");
  assert.match(workbook.Sheets.Summary.D30?.f ?? "", /"GOOGL\.NEW"/);
  assert.match(workbook.Sheets.Shareholders.F4?.f ?? "", /"GOOGL\.NEW"/);
  assert.equal(workbook.Sheets.Holdings.E10?.v, 10997.25);
  assert.equal(workbook.Sheets.Holdings.E11?.v, 10997.25);
  assert.equal(workbook.Sheets.Holdings.F10?.f, "C10*E10");
  assert.equal(countFormulas(workbook), countFormulas(original));
  assert.equal(
    workbook.Sheets.Holdings["!merges"]?.length,
    original.Sheets.Holdings["!merges"]?.length,
  );
  assert.ok(workbook.Sheets["Dashboard Audit"]);
  assert.equal(workbook.Sheets["Dashboard Audit"].A1?.v, "Exported at");
  assert.equal(workbook.Sheets["Dashboard Audit"].C2?.v, "GOOGL");
  assert.equal(workbook.Sheets["Dashboard Audit"].D2?.v, "GOOGL.NEW");
});

test("rejects a global rename that would collide with an unchanged holding", async () => {
  const source = await readSourceWorkbook();
  const request = baseRequest();
  request.renames = [{ from: "GOOGL", to: "SCB" }];

  assert.throws(
    () => exportEditedWorkbook(source, request),
    /duplicate|already active/i,
  );
});

test("exports forecast DPS without changing the historical dividend record", async () => {
  const source = await readSourceWorkbook();
  const request = baseRequest();
  request.dividendUpdates = [{ ticker: "SCB", dps: 10 }];
  request.whtRate = 0.07;

  const exported = exportEditedWorkbook(source, request);
  const workbook = XLSX.read(exported.bytes, { type: "array", cellFormula: true });

  assert.equal(workbook.Sheets.Dividends.C39?.v, 10);
  assert.equal(workbook.Sheets.Dividends.C6?.v, 9.28);
  assert.equal(workbook.Sheets.Dividends.B3?.v, 0.07);
  assert.equal(workbook.Sheets.Dividends.D6?.f, "B6*C6");
  assert.equal(workbook.Sheets.Dividends.D39?.f, "B39*C39");
  assert.equal(workbook.Sheets.Transactions.G50?.v, 365.6475925926);
});

test("parses Yahoo search candidates and a current quote without guessing a symbol", () => {
  const candidates = parseYahooSearch({
    quotes: [
      {
        symbol: "SCB.BK",
        shortname: "SCB X Public Company Limited",
        exchange: "SET",
        currency: "THB",
        quoteType: "EQUITY",
      },
      { symbol: "", shortname: "Incomplete result" },
    ],
  });
  const quote = parseYahooChartQuote({
    chart: {
      result: [
        {
          meta: {
            symbol: "SCB.BK",
            regularMarketPrice: 124.5,
            currency: "THB",
            exchangeName: "SET",
            marketState: "REGULAR",
            regularMarketTime: 1784101740,
          },
        },
      ],
    },
  });

  assert.deepEqual(candidates, [
    {
      symbol: "SCB.BK",
      name: "SCB X Public Company Limited",
      exchange: "SET",
      currency: "THB",
      quoteType: "EQUITY",
    },
  ]);
  assert.deepEqual(quote, {
    symbol: "SCB.BK",
    price: 124.5,
    currency: "THB",
    exchange: "SET",
    marketState: "REGULAR",
    quoteTimestamp: "2026-07-15T07:49:00.000Z",
  });
  assert.equal(parseYahooChartQuote({ chart: { result: [] } }), null);
  assert.equal(isYahooCandidateCurrencyCompatible("—", "USD"), true);
  assert.equal(isYahooCandidateCurrencyCompatible("THB", "USD"), false);
});
