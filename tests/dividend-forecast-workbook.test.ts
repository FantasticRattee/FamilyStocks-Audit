import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import XLSX from "xlsx";

const sourceWorkbook = new URL(
  "../../Portfolio_Accounting.xlsx",
  import.meta.url,
);

const readWorkbook = async () => {
  const file = await readFile(sourceWorkbook);
  return XLSX.read(file, {
    type: "buffer",
    cellFormula: true,
    cellStyles: true,
  });
};

const normalizeFormula = (formula: string | undefined) =>
  (formula ?? "").replaceAll("'", "");

test("keeps the past payout while adding a current-capital dividend forecast", async () => {
  const workbook = await readWorkbook();
  const dividends = workbook.Sheets.Dividends;

  assert.equal(dividends.A29?.v, "DIVIDEND FORECAST (CURRENT CAPITAL)");
  assert.equal(dividends.A31?.v, "Shareholder");
  assert.equal(dividends.B31?.v, "Current Capital");
  assert.equal(dividends.C31?.v, "Capital %");
  assert.equal(dividends.D31?.v, "Gross forecast");
  assert.equal(dividends.E31?.v, "WHT (10%)");
  assert.equal(dividends.F31?.v, "Net forecast");

  assert.equal(normalizeFormula(dividends.B32?.f), "Shareholders!B4");
  assert.equal(normalizeFormula(dividends.B33?.f), "Shareholders!B5");
  assert.equal(normalizeFormula(dividends.B34?.f), "Shareholders!B6");
  assert.equal(dividends.C32?.f, "IFERROR(B32/$B$35,0)");
  assert.equal(dividends.D32?.f, "B32*$D$42");
  assert.equal(dividends.E32?.f, "D32*$B$3");
  assert.equal(dividends.F32?.f, "D32-E32");
  assert.equal(dividends.D35?.f, "SUM(D32:D34)");

  assert.equal(dividends.A37?.v, "PRIOR-YEAR RECURRING DIVIDEND ASSUMPTIONS");
  assert.equal(normalizeFormula(dividends.B39?.f), "Holdings!C14");
  assert.equal(dividends.C39?.v, 11.28);
  assert.equal(normalizeFormula(dividends.B40?.f), "Holdings!C15");
  assert.equal(dividends.C40?.v, 12);
  assert.match(dividends.E40?.v ?? "", /special.*excluded/i);
  assert.equal(dividends.D41?.f, "SUM(D39:D40)");
  assert.equal(
    normalizeFormula(dividends.B42?.f),
    "Holdings!C14*Holdings!D14+Holdings!C15*Holdings!D15",
  );
  assert.equal(dividends.D42?.f, "IFERROR(D41/B42,0)");

  assert.ok(Math.abs((dividends.D35?.v ?? Number.NaN) - 176748.72) < 0.01);
  assert.ok(Math.abs((dividends.F35?.v ?? Number.NaN) - 159073.848) < 0.01);

  assert.equal(dividends.D6?.v, 71688);
  assert.equal(dividends.F6?.v, 64519.2);
});
