import assert from "node:assert/strict";
import test from "node:test";

import { handleMarketApiRequest } from "../app/dashboard/market-api";

test("uses a Worker-only OpenAI key for one sourced market refresh", async () => {
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  const response = await handleMarketApiRequest(
    new Request("https://dashboard.local/api/market/refresh"),
    async (input, init) => {
      const url = new URL(String(input));
      calls.push({ url, init });
      assert.equal(url.toString(), "https://api.openai.com/v1/responses");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-openai-key");

      const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(request.model, "gpt-5.6");
      assert.equal(request.tool_choice, "required");
      assert.deepEqual(request.tools, [
        {
          type: "web_search",
          search_context_size: "low",
          external_web_access: true,
        },
      ]);

      return Response.json({
        created_at: 1784131200,
        output: [
          {
            type: "web_search_call",
            action: {
              type: "search",
              sources: [
                {
                  url: "https://www.google.com/finance/quote/GOOGL:NASDAQ",
                  title: "Alphabet Inc Class A",
                },
              ],
            },
          },
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  quotes: [
                    { key: "GOOGL", price: 372.49 },
                    { key: "USDTHB", price: 33.8 },
                    { key: "SCB", price: 122.5 },
                    { key: "KBANK", price: 175.5 },
                  ],
                }),
              },
            ],
          },
        ],
      });
    },
    { OPENAI_API_KEY: "test-openai-key" },
  );

  assert.ok(response);
  const body = (await response.json()) as {
    provider?: string;
    quotes: Record<string, Record<string, unknown>>;
    failures: Record<string, string>;
    sources?: Array<{ url: string; title: string }>;
  };
  assert.equal(calls.length, 1);
  assert.equal(body.provider, "OpenAI web search");
  assert.deepEqual(body.quotes.GOOGL, {
    symbol: "GOOGL",
    price: 372.49,
    currency: "USD",
    exchange: "NASDAQ",
    marketState: "SEARCHED",
    quoteTimestamp: "2026-07-15T16:00:00.000Z",
    source: "OpenAI web search",
    freshness: "searched live",
  });
  assert.equal(body.quotes.USDTHB?.currency, "THB");
  assert.equal(body.quotes.SCB?.exchange, "SET");
  assert.equal(body.quotes.KBANK?.price, 175.5);
  assert.deepEqual(body.failures, {});
  assert.deepEqual(body.sources, [
    {
      url: "https://www.google.com/finance/quote/GOOGL:NASDAQ",
      title: "Alphabet Inc Class A",
    },
  ]);
});

test("returns Google Finance and EODHD quotes through the hybrid dashboard refresh", async () => {
  const calls: URL[] = [];
  const response = await handleMarketApiRequest(
    new Request("https://dashboard.local/api/market/refresh"),
    async (input) => {
      const url = new URL(String(input));
      calls.push(url);
      if (url.hostname === "bridge.example") {
        return Response.json({
          fetchedAt: "2026-07-16T04:00:00.000Z",
          quotes: {
            GOOGL: {
              price: 371.57,
              currency: "USD",
              quoteTimestamp: "2026-07-16T03:55:00.000Z",
            },
            USDTHB: {
              price: 33.588,
              currency: "THB",
              quoteTimestamp: "2026-07-16T03:55:00.000Z",
            },
          },
        });
      }

      const ticker = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
      return Response.json([
        {
          date: "2026-07-15",
          close: ticker === "SCB.BK" ? 122.5 : 176.5,
        },
      ]);
    },
    {
      GOOGLE_FINANCE_BRIDGE_URL: "https://bridge.example/market",
      EODHD_API_TOKEN: "test-eodhd-token",
    },
  );

  assert.ok(response);
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    quotes: Record<string, Record<string, unknown>>;
    failures: Record<string, string>;
  };
  assert.deepEqual(body.quotes.GOOGL, {
    symbol: "GOOGL",
    price: 371.57,
    currency: "USD",
    exchange: "NASDAQ",
    marketState: "DELAYED",
    quoteTimestamp: "2026-07-16T03:55:00.000Z",
    source: "Google Finance",
    freshness: "delayed",
  });
  assert.deepEqual(body.quotes.USDTHB, {
    symbol: "USDTHB",
    price: 33.588,
    currency: "THB",
    exchange: "FX",
    marketState: "DELAYED",
    quoteTimestamp: "2026-07-16T03:55:00.000Z",
    source: "Google Finance",
    freshness: "delayed",
  });
  assert.deepEqual(body.quotes.SCB, {
    symbol: "SCB.BK",
    price: 122.5,
    currency: "THB",
    exchange: "SET",
    marketState: "CLOSED",
    quoteTimestamp: "2026-07-15T00:00:00.000Z",
    source: "EODHD",
    freshness: "latest close",
  });
  assert.equal(body.quotes.KBANK?.price, 176.5);
  assert.deepEqual(body.failures, {});
  assert.equal(calls.filter((url) => url.hostname === "bridge.example").length, 1);
  const eodhdCalls = calls.filter((url) => url.hostname === "eodhd.com");
  assert.deepEqual(eodhdCalls.map((url) => url.pathname).sort(), [
    "/api/eod/KBANK.BK",
    "/api/eod/SCB.BK",
  ]);
  assert.ok(eodhdCalls.every((url) => url.searchParams.get("api_token") === "test-eodhd-token"));
});

test("returns Yahoo search candidates without silently choosing one", async () => {
  const calls: string[] = [];
  const response = await handleMarketApiRequest(
    new Request("https://dashboard.local/api/market/search?q=Visa"),
    async (input) => {
      calls.push(String(input));
      return Response.json({
        quotes: [
          {
            symbol: "V",
            shortname: "Visa Inc.",
            exchange: "NYQ",
            currency: "USD",
            quoteType: "EQUITY",
          },
          {
            symbol: "VISA.L",
            shortname: "Visa Inc. London",
            exchange: "LSE",
            currency: "GBp",
            quoteType: "EQUITY",
          },
        ],
      });
    },
  );

  assert.ok(response);
  assert.equal(response.status, 200);
  assert.match(calls[0], /query1\.finance\.yahoo\.com\/v1\/finance\/search/);
  const body = (await response.json()) as { candidates: Array<{ symbol: string }> };
  assert.deepEqual(body.candidates.map((candidate) => candidate.symbol), ["V", "VISA.L"]);
});

test("turns a Yahoo rate limit into an explicit manual-price fallback", async () => {
  const response = await handleMarketApiRequest(
    new Request("https://dashboard.local/api/market/quote?symbol=V"),
    async () => new Response("Too Many Requests", { status: 429 }),
  );

  assert.ok(response);
  assert.equal(response.status, 429);
  const body = (await response.json()) as { manualFallback: boolean; error: string };
  assert.equal(body.manualFallback, true);
  assert.match(body.error, /rate limit/i);
});

test("returns a manual-refresh batch with valid quotes and explicit per-symbol failures", async () => {
  const calls: string[] = [];
  const response = await handleMarketApiRequest(
    new Request(
      "https://dashboard.local/api/market/quotes?symbols=GOOGL,SCB.BK,USDTHB%3DX",
    ),
    async (input) => {
      const url = new URL(String(input));
      const symbol = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
      calls.push(symbol);
      if (symbol === "SCB.BK") {
        return new Response("Too Many Requests", { status: 429 });
      }
      return Response.json({
        chart: {
          result: [
            {
              meta: {
                symbol,
                regularMarketPrice: symbol === "GOOGL" ? 400 : 34.25,
                currency: symbol === "GOOGL" ? "USD" : "THB",
                exchangeName: "Mock exchange",
                marketState: "REGULAR",
                regularMarketTime: 1784131200,
              },
            },
          ],
        },
      });
    },
  );

  assert.ok(response);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(calls.sort(), ["GOOGL", "SCB.BK", "USDTHB=X"]);

  const body = (await response.json()) as {
    quotes: Record<string, { price: number; currency: string }>;
    failures: Record<string, string>;
    fetchedAt: string;
  };
  assert.deepEqual(body.quotes.GOOGL, {
    symbol: "GOOGL",
    price: 400,
    currency: "USD",
    exchange: "Mock exchange",
    marketState: "REGULAR",
    quoteTimestamp: "2026-07-15T16:00:00.000Z",
  });
  assert.equal(body.quotes["USDTHB=X"]?.price, 34.25);
  assert.match(body.failures["SCB.BK"] ?? "", /rate limit/i);
  assert.match(body.fetchedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("bypasses a previous single-quote cache entry when manually refreshing", async () => {
  let requestCount = 0;
  const fetchQuote = async (input: RequestInfo | URL) => {
    requestCount += 1;
    const symbol = decodeURIComponent(
      new URL(String(input)).pathname.split("/").at(-1) ?? "",
    );
    return Response.json({
      chart: {
        result: [
          {
            meta: {
              symbol,
              regularMarketPrice: requestCount === 1 ? 100 : 101,
              currency: "USD",
              exchangeName: "Mock exchange",
              marketState: "REGULAR",
            },
          },
        ],
      },
    });
  };

  const single = await handleMarketApiRequest(
    new Request("https://dashboard.local/api/market/quote?symbol=TESTLIVE"),
    fetchQuote,
  );
  assert.ok(single);
  assert.equal(
    (await single.json() as { quote: { price: number } }).quote.price,
    100,
  );

  const batch = await handleMarketApiRequest(
    new Request("https://dashboard.local/api/market/quotes?symbols=TESTLIVE"),
    fetchQuote,
  );
  assert.ok(batch);
  const body = (await batch.json()) as {
    quotes: Record<string, { price: number }>;
  };
  assert.equal(body.quotes.TESTLIVE?.price, 101);
  assert.equal(requestCount, 2);
});
