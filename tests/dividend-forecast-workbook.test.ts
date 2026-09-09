import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  assert.equal(dividends.B39?.v, 0);
  assert.equal(dividends.B39?.f, undefined);
  assert.equal(dividends.C39?.v, 11.28);
  assert.equal(dividends.B40?.v, 0);
  assert.equal(dividends.B40?.f, undefined);
  assert.equal(dividends.C40?.v, 12);
  assert.match(dividends.E40?.v ?? "", /special.*excluded/i);
  assert.equal(dividends.D41?.f, "SUM(D39:D40)");
  assert.equal(
    normalizeFormula(dividends.B42?.f),
    "Shareholders!B7",
  );
  assert.equal(dividends.D42?.f, "IFERROR(D41/B42,0)");

  for (const [address, expected] of [
    ["B32", 1550000],
    ["B33", 300000],
    ["B34", 1464606.003945636],
    ["B35", 3314606.003945636],
    ["B42", 3314606.003945636],
  ] as const) {
    assert.ok(Math.abs((dividends[address]?.v ?? Number.NaN) - expected) < 0.000001, address);
  }

  assert.ok(Math.abs((dividends.D35?.v ?? Number.NaN) - 0) < 0.01);
  assert.ok(Math.abs((dividends.F35?.v ?? Number.NaN) - 0) < 0.01);

  assert.equal(dividends.D6?.v, 71688);
  assert.equal(dividends.F6?.v, 64519.2);
});

test("preserves the April dividend section values and formulas through the September update", async () => {
  const workbook = await readWorkbook();
  const dividends = workbook.Sheets.Dividends;
  const cells = [];
  for (let row = 1; row <= 28; row += 1) {
    for (let column = 0; column < 6; column += 1) {
      const address = XLSX.utils.encode_cell({ r: row - 1, c: column });
      const cell = dividends[address];
      cells.push([address, cell?.v ?? null, cell?.f ?? null]);
    }
  }
  // Frozen from A1:F28 of the pre-update canonical workbook; styling is excluded.
  assert.equal(
    createHash("sha256").update(JSON.stringify(cells)).digest("hex"),
    "62c2f98a37e691b907720303d6571dd86a4b45b2af88240085e550fd99067d69",
  );
});
