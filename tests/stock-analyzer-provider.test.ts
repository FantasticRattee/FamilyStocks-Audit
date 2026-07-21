import assert from "node:assert/strict";
import test from "node:test";

import { fetchStockAnalyzerInput } from "../app/dashboard/stock-analyzer-provider";

test("normalizes Tiingo history and keeps provider keys out of the stored payload", async () => {
  const calls: Array<{ url: string; authorization?: string | null }> = [];
  const currentYear = new Date().getUTCFullYear();
  const nextEstimateDate = `${currentYear + 1}-06-30`;
  const result = await fetchStockAnalyzerInput(
    "msft",
    { TIINGO_API_KEY: "tiingo-secret", FMP_API_KEY: "fmp-secret" },
    async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({ url, authorization: headers.get("authorization") });
      if (url.includes("/prices")) {
        return Response.json([
          { date: "2024-01-02T00:00:00.000Z", close: 370, adjClose: 366 },
          { date: "2024-01-03T00:00:00.000Z", close: 375, adjClose: 371 },
        ]);
      }
      if (url.includes("/fundamentals/")) {
        return Response.json([
          { date: "2024-01-03", peRatio: 31.4 },
          { date: "2023-12-29", peRatio: -5 },
        ]);
      }
      if (url.includes("financialmodelingprep.com")) {
        return Response.json([
          { date: `${currentYear - 1}-06-30`, estimatedEpsAvg: 9 },
          { date: `${currentYear + 2}-06-30`, estimatedEpsAvg: 18 },
          { date: nextEstimateDate, estimatedEpsAvg: 15 },
        ]);
      }
      return new Response("Unexpected endpoint", { status: 500 });
    },
  );

  assert.equal(result.input.ticker, "MSFT");
  assert.deepEqual(result.input.prices.at(-1), {
    date: "2024-01-03",
    close: 375,
    adjustedClose: 371,
  });
  assert.deepEqual(result.input.trailingPe.at(-1), { date: "2023-12-29", value: -5 });
  assert.equal(result.input.forwardEps?.value, 15);
  assert.equal(result.input.forwardEps?.asOfDate, nextEstimateDate);
  assert.equal(result.source.price, "Tiingo EOD");
  assert.equal(calls.filter((call) => call.url.includes("api.tiingo.com")).length, 2);
  assert.ok(calls.filter((call) => call.url.includes("api.tiingo.com")).every(
    (call) => call.authorization === "Token tiingo-secret",
  ));
  assert.doesNotMatch(JSON.stringify(result), /tiingo-secret|fmp-secret/);
});
