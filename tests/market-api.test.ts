import assert from "node:assert/strict";
import test from "node:test";

import { handleMarketApiRequest } from "../app/dashboard/market-api";
import type { MarketQuotePersistenceRepository } from "../app/dashboard/portfolio-repository";

const googleQuotePage = (identifier: string, price: string) => `
  <main>
    <div title="${identifier}"></div>
    <div class="N6SYTe"><span><span>${price}</span></span></div>
    <div class="jZZ2de">Jul 20, 12:18:45 PM GMT-4 · USD</div>
  </main>
`;

const setQuotePage = (symbol: string, price: number) => `
  <div class="price-info-stock-detail"><label>Last</label> <span>${price.toFixed(2)}</span></div>
  <script>
    window.__NUXT__={data:[{quote:{info:{symbol:"${symbol}",prior:157,last:${price},open:156.5,marketDateTime:"2026-07-20T23:21:32.670657178+07:00"}}}]};
  </script>
`;

test("refreshes configured Google Finance and SET public quotes without an OpenAI key", async () => {
  const calls: URL[] = [];
  const response = await handleMarketApiRequest(
    new Request("https://dashboard.local/api/market/refresh"),
    async (input) => {
      const url = new URL(String(input));
      calls.push(url);
      if (url.hostname === "www.google.com" && url.pathname.includes("GOOGL")) {
        return new Response(googleQuotePage("GOOGL:NASDAQ", "$355.60"));
      }
      if (url.hostname === "www.google.com" && url.pathname.includes("USD-THB")) {
        return new Response(googleQuotePage("USD-THB", "32.50"));
      }
      if (url.pathname.endsWith("/SCB/price")) return new Response(setQuotePage("SCB", 158.5));
      if (url.pathname.endsWith("/KBANK/price")) return new Response(setQuotePage("KBANK", 231));
      return new Response("Not found", { status: 404 });
    },
  );

  assert.ok(response);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = (await response.json()) as {
    provider?: string;
    quotes: Record<string, { price: number; source?: string; exchange: string }>;
    failures: Record<string, string>;
    sources?: Array<{ url: string; title: string }>;
  };
  assert.deepEqual(
    calls.map((call) => call.hostname).sort(),
    ["www.google.com", "www.google.com", "www.set.or.th", "www.set.or.th"],
  );
  assert.ok(calls.every((call) => call.hostname !== "api.openai.com"));
  assert.equal(body.provider, "Google Finance + SET public quotes");
  assert.equal(body.quotes.GOOGL?.price, 355.6);
  assert.equal(body.quotes.GOOGL?.exchange, "NASDAQ");
  assert.equal(body.quotes.GOOGL?.source, "Google Finance");
  assert.equal(body.quotes.USDTHB?.price, 32.5);
  assert.equal(body.quotes.SCB?.price, 158.5);
  assert.equal(body.quotes.SCB?.source, "SET public quote");
  assert.equal(body.quotes.KBANK?.price, 231);
  assert.deepEqual(body.failures, {});
  assert.deepEqual(body.sources?.map((source) => source.url), [
    "https://www.google.com/finance/quote/GOOGL:NASDAQ?hl=en",
    "https://www.google.com/finance/quote/USD-THB?hl=en",
    "https://www.set.or.th/en/market/product/stock/quote/SCB/price",
    "https://www.set.or.th/en/market/product/stock/quote/KBANK/price",
  ]);
});

test("always fetches and persists a fresh public quote instead of reusing a cooldown", async () => {
  let loadCalls = 0;
  let persistCalls = 0;
  let persisted: unknown;
  const persistence = {
    async loadRecentMarketRefresh() {
      loadCalls += 1;
      throw new Error("The free refresh must not read a cooldown.");
    },
    async persistMarketRefresh(refresh: unknown) {
      persistCalls += 1;
      persisted = refresh;
      return {
        ...(refresh as object),
        refreshedKeys: ["GOOGL", "USDTHB", "SCB", "KBANK"],
        retainedKeys: [],
      };
    },
  } as unknown as MarketQuotePersistenceRepository;

  const response = await handleMarketApiRequest(
    new Request("https://dashboard.local/api/market/refresh"),
    async (input) => {
      const url = new URL(String(input));
      if (url.pathname.includes("GOOGL")) return new Response(googleQuotePage("GOOGL:NASDAQ", "$356.25"));
      if (url.pathname.includes("USD-THB")) return new Response(googleQuotePage("USD-THB", "32.75"));
      if (url.pathname.endsWith("/SCB/price")) return new Response(setQuotePage("SCB", 159));
      return new Response(setQuotePage("KBANK", 232));
    },
    persistence,
  );

  assert.ok(response);
  assert.equal(loadCalls, 0);
  assert.equal(persistCalls, 1);
  assert.deepEqual(Object.keys((persisted as { quotes: object }).quotes).sort(), [
    "GOOGL",
    "KBANK",
    "SCB",
    "USDTHB",
  ]);
  const body = (await response.json()) as { cooldownActive?: boolean; refreshedKeys: string[] };
  assert.equal(body.cooldownActive, undefined);
  assert.deepEqual(body.refreshedKeys, ["GOOGL", "USDTHB", "SCB", "KBANK"]);
});

test("returns per-key failures from a public source without overwriting the other quotes", async () => {
  const response = await handleMarketApiRequest(
    new Request("https://dashboard.local/api/market/refresh"),
    async (input) => {
      const url = new URL(String(input));
      if (url.pathname.includes("GOOGL")) return new Response(googleQuotePage("GOOGL:NASDAQ", "$355.60"));
      if (url.pathname.includes("USD-THB")) return new Response(googleQuotePage("USD-THB", "32.50"));
      if (url.pathname.endsWith("/SCB/price")) return new Response("source unavailable", { status: 503 });
      return new Response(setQuotePage("KBANK", 231));
    },
  );

  assert.ok(response);
  const body = (await response.json()) as {
    quotes: Record<string, { price: number }>;
    failures: Record<string, string>;
  };
  assert.equal(body.quotes.GOOGL?.price, 355.6);
  assert.equal(body.quotes.KBANK?.price, 231);
  assert.match(body.failures.SCB ?? "", /SET public quote returned HTTP 503/i);
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
