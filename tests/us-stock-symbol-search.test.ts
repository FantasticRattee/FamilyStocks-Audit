import assert from "node:assert/strict";
import test from "node:test";

type SymbolHint = {
  symbol: string;
  name: string;
};

type SymbolSearchModule = {
  searchUsSymbolHints(query: string, limit?: number): SymbolHint[];
};

const loadSymbolSearch = async (): Promise<SymbolSearchModule | null> => {
  try {
    return await import(
      new URL("../app/dashboard/us-stock-symbol-search.ts", import.meta.url).href,
    ) as SymbolSearchModule;
  } catch (error) {
    if (error instanceof Error && /Cannot find module|ERR_MODULE_NOT_FOUND/.test(error.message)) {
      return null;
    }
    throw error;
  }
};

test("finds U.S. stock hints from both ticker prefixes and company-name fragments", async () => {
  const symbolSearch = await loadSymbolSearch();
  assert.ok(symbolSearch, "the client-side U.S. symbol search module must exist");
  if (!symbolSearch) return;

  const amazonHints = symbolSearch.searchUsSymbolHints("AMA");
  assert.equal(amazonHints[0]?.symbol, "AMZN");
  assert.match(amazonHints[0]?.name ?? "", /amazon/i);

  const aHints = symbolSearch.searchUsSymbolHints("A", 12);
  assert.ok(aHints.some((hint) => hint.symbol === "AAPL"));
  assert.ok(aHints.some((hint) => hint.symbol === "AMZN"));
  assert.ok(aHints.some((hint) => hint.symbol === "ARM"));
});

test("does not invent a default result for an empty symbol query", async () => {
  const symbolSearch = await loadSymbolSearch();
  assert.ok(symbolSearch, "the client-side U.S. symbol search module must exist");
  if (!symbolSearch) return;

  assert.deepEqual(symbolSearch.searchUsSymbolHints(""), []);
});
