import assert from "node:assert/strict";
import test from "node:test";

import {
  isYahooCandidateCurrencyCompatible,
  parseYahooChartQuote,
  parseYahooSearch,
} from "../app/dashboard/market-data";

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
