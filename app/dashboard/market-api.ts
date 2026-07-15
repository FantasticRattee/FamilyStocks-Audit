import {
  isSafeYahooSymbol,
  parseYahooChartQuote,
  parseYahooSearch,
  type MarketQuote,
} from "./market-data";

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type CachedPayload = {
  expiresAt: number;
  body: Record<string, unknown>;
};

type YahooFailure = {
  error: string;
  manualFallback: true;
  status: number;
};

type YahooReadResult =
  | { payload: unknown }
  | { failure: YahooFailure };

type YahooQuoteResult =
  | { quote: MarketQuote }
  | { failure: YahooFailure };

export type MarketApiEnvironment = {
  OPENAI_API_KEY?: string;
  OPENAI_MARKET_MODEL?: string;
  EODHD_API_TOKEN?: string;
  GOOGLE_FINANCE_BRIDGE_URL?: string;
};

type ProviderQuoteResult =
  | { quote: MarketQuote }
  | { failure: string };

type GoogleFinanceBridgeQuote = {
  currency: "THB" | "USD";
  exchange: string;
};

const GOOGLE_FINANCE_BRIDGE_QUOTES: Record<string, GoogleFinanceBridgeQuote> = {
  GOOGL: { currency: "USD", exchange: "NASDAQ" },
  USDTHB: { currency: "THB", exchange: "FX" },
};

const EODHD_THAILAND_QUOTES = [
  { key: "SCB", symbol: "SCB.BK" },
  { key: "KBANK", symbol: "KBANK.BK" },
] as const;

const OPENAI_MARKET_QUOTES = {
  GOOGL: { symbol: "GOOGL", currency: "USD", exchange: "NASDAQ" },
  USDTHB: { symbol: "USDTHB", currency: "THB", exchange: "FX" },
  SCB: { symbol: "SCB", currency: "THB", exchange: "SET" },
  KBANK: { symbol: "KBANK", currency: "THB", exchange: "SET" },
} as const;

type OpenAiMarketKey = keyof typeof OPENAI_MARKET_QUOTES;

type MarketRefreshSource = {
  url: string;
  title: string;
};

type MarketRefreshPayload = {
  quotes: Record<string, MarketQuote>;
  failures: Record<string, string>;
  fetchedAt: string;
  provider?: string;
  sources?: MarketRefreshSource[];
};

const OPENAI_MARKET_RESPONSE_URL = "https://api.openai.com/v1/responses";

const OPENAI_MARKET_SCHEMA = {
  type: "object",
  properties: {
    quotes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string", enum: Object.keys(OPENAI_MARKET_QUOTES) },
          price: { type: "number" },
        },
        required: ["key", "price"],
        additionalProperties: false,
      },
    },
  },
  required: ["quotes"],
  additionalProperties: false,
};

const OPENAI_MARKET_INPUT = [
  "Use live web search to find exact, current market prices. Return only JSON matching the schema.",
  "Do not estimate, calculate, convert currencies, or use an old price when a current quote is unavailable.",
  "Include only a ticker whose numeric price can be verified from the search results.",
  "GOOGL: Alphabet Class A share price in USD on NASDAQ.",
  "USDTHB: USD to THB exchange-rate quote in THB per USD.",
  "SCB: Siam Commercial Bank share price in THB on SET.",
  "KBANK: Kasikornbank share price in THB on SET.",
].join("\n");

const cacheTtlMs = 5 * 60 * 1000;
const responseCache = new Map<string, CachedPayload>();

const json = (
  body: Record<string, unknown>,
  status = 200,
  cacheControl = status === 200 ? "public, max-age=300" : "no-store",
) =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": cacheControl,
    },
  });

const cachedPayload = (key: string) => {
  const cached = responseCache.get(key);
  if (!cached || cached.expiresAt <= Date.now()) {
    responseCache.delete(key);
    return null;
  }
  return cached.body;
};

const cachedResponse = (key: string) => {
  const body = cachedPayload(key);
  return body ? json(body) : null;
};

const remember = (key: string, body: Record<string, unknown>) => {
  responseCache.set(key, { body, expiresAt: Date.now() + cacheTtlMs });
};

const yahooFailure = (status: number): YahooFailure => {
  if (status === 429) {
    return {
      error: "Yahoo Finance rate limit reached. Enter a manual price or retry later.",
      manualFallback: true,
      status: 429,
    };
  }
  return {
    error: "Yahoo Finance is temporarily unavailable. Enter a manual price or retry later.",
    manualFallback: true,
    status: 502,
  };
};

const readYahooJson = async (
  target: string,
  fetchImplementation: FetchImplementation,
): Promise<YahooReadResult> => {
  try {
    const response = await fetchImplementation(target, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) return { failure: yahooFailure(response.status) };
    return { payload: await response.json() };
  } catch {
    return {
      failure: {
        error: "Yahoo Finance could not be reached. Enter a manual price or retry later.",
        manualFallback: true,
        status: 502,
      },
    };
  }
};

const isMarketQuote = (value: unknown): value is MarketQuote => {
  if (!value || typeof value !== "object") return false;
  const quote = value as Partial<MarketQuote>;
  return (
    typeof quote.symbol === "string" &&
    typeof quote.price === "number" &&
    Number.isFinite(quote.price) &&
    quote.price > 0 &&
    typeof quote.currency === "string" &&
    typeof quote.exchange === "string" &&
    typeof quote.marketState === "string"
  );
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const positiveFinite = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;

const recentIsoDate = (daysAgo = 14) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
};

const quoteTimestampFromEodDate = (value: unknown) => {
  const date = text(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00.000Z` : undefined;
};

const httpsUrl = (value: unknown) => {
  const raw = text(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

const marketRefreshFailures = (message: string) =>
  Object.fromEntries(Object.keys(OPENAI_MARKET_QUOTES).map((key) => [key, message]));

const responseTimestamp = (payload: unknown) => {
  const createdAt = positiveFinite(asRecord(payload)?.created_at);
  return createdAt ? new Date(createdAt * 1000).toISOString() : new Date().toISOString();
};

const openAiOutputText = (payload: unknown) => {
  const root = asRecord(payload);
  const rootOutputText = text(root?.output_text);
  if (rootOutputText) return rootOutputText;
  if (!Array.isArray(root?.output)) return "";

  return root.output
    .flatMap((item) => {
      const message = asRecord(item);
      if (!Array.isArray(message?.content)) return [];
      return message.content.flatMap((content) => {
        const part = asRecord(content);
        return part?.type === "output_text" ? [text(part.text)] : [];
      });
    })
    .filter(Boolean)
    .join("\n");
};

const openAiSources = (payload: unknown): MarketRefreshSource[] => {
  const root = asRecord(payload);
  if (!Array.isArray(root?.output)) return [];

  const sources = new Map<string, MarketRefreshSource>();
  const add = (value: unknown) => {
    const source = asRecord(value);
    const url = httpsUrl(source?.url);
    if (!url || sources.has(url)) return;
    sources.set(url, { title: text(source?.title) || new URL(url).hostname, url });
  };

  for (const item of root.output) {
    const output = asRecord(item);
    const action = asRecord(output?.action);
    if (Array.isArray(action?.sources)) action.sources.forEach(add);
    if (!Array.isArray(output?.content)) continue;
    for (const content of output.content) {
      const part = asRecord(content);
      if (!Array.isArray(part?.annotations)) continue;
      part.annotations.forEach(add);
    }
  }

  return [...sources.values()].slice(0, 6);
};

const parseOpenAiMarketQuotes = (
  payload: unknown,
  quoteTimestamp: string,
): Record<string, MarketQuote> | null => {
  const rawOutput = openAiOutputText(payload);
  if (!rawOutput) return null;

  try {
    const result = asRecord(JSON.parse(rawOutput));
    if (!Array.isArray(result?.quotes)) return null;

    const quotes: Record<string, MarketQuote> = {};
    for (const item of result.quotes) {
      const candidate = asRecord(item);
      const key = text(candidate?.key).toUpperCase() as OpenAiMarketKey;
      const config = OPENAI_MARKET_QUOTES[key];
      const price = positiveFinite(candidate?.price);
      if (!config || !price || quotes[key]) continue;
      quotes[key] = {
        symbol: config.symbol,
        price,
        currency: config.currency,
        exchange: config.exchange,
        marketState: "SEARCHED",
        quoteTimestamp,
        source: "OpenAI web search",
        freshness: "searched live",
      };
    }
    return quotes;
  } catch {
    return null;
  }
};

const refreshOpenAiMarketQuotes = async (
  environment: MarketApiEnvironment,
  fetchImplementation: FetchImplementation,
): Promise<MarketRefreshPayload> => {
  const apiKey = environment.OPENAI_API_KEY?.trim();
  const fallbackTimestamp = new Date().toISOString();
  if (!apiKey) {
    return {
      quotes: {},
      failures: marketRefreshFailures("OpenAI is not configured. Add OPENAI_API_KEY."),
      fetchedAt: fallbackTimestamp,
      provider: "OpenAI web search",
    };
  }

  let response: Response;
  try {
    response = await fetchImplementation(OPENAI_MARKET_RESPONSE_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: environment.OPENAI_MARKET_MODEL?.trim() || "gpt-5.6",
        tools: [
          {
            type: "web_search",
            search_context_size: "low",
            external_web_access: true,
          },
        ],
        tool_choice: "required",
        include: ["web_search_call.action.sources"],
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: "market_quotes",
            strict: true,
            schema: OPENAI_MARKET_SCHEMA,
          },
        },
        input: OPENAI_MARKET_INPUT,
      }),
    });
  } catch {
    return {
      quotes: {},
      failures: marketRefreshFailures("OpenAI web search could not be reached."),
      fetchedAt: fallbackTimestamp,
      provider: "OpenAI web search",
    };
  }

  if (!response.ok) {
    return {
      quotes: {},
      failures: marketRefreshFailures(`OpenAI web search returned HTTP ${response.status}.`),
      fetchedAt: fallbackTimestamp,
      provider: "OpenAI web search",
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      quotes: {},
      failures: marketRefreshFailures("OpenAI web search returned unreadable data."),
      fetchedAt: fallbackTimestamp,
      provider: "OpenAI web search",
    };
  }

  const fetchedAt = responseTimestamp(payload);
  const sources = openAiSources(payload);
  if (sources.length === 0) {
    return {
      quotes: {},
      failures: marketRefreshFailures("OpenAI web search returned no auditable sources."),
      fetchedAt,
      provider: "OpenAI web search",
    };
  }

  const quotes = parseOpenAiMarketQuotes(payload, fetchedAt);
  if (!quotes) {
    return {
      quotes: {},
      failures: marketRefreshFailures("OpenAI web search did not return a valid quote response."),
      fetchedAt,
      provider: "OpenAI web search",
      sources,
    };
  }

  const failures: Record<string, string> = {};
  for (const [key, config] of Object.entries(OPENAI_MARKET_QUOTES)) {
    if (!quotes[key]) {
      failures[key] = `OpenAI web search did not return a valid ${config.currency} quote for ${key}.`;
    }
  }
  return { quotes, failures, fetchedAt, provider: "OpenAI web search", sources };
};

const readProviderJson = async (
  target: string,
  provider: string,
  fetchImplementation: FetchImplementation,
): Promise<{ payload: unknown } | { failure: string }> => {
  try {
    const response = await fetchImplementation(target, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return { failure: `${provider} returned HTTP ${response.status}.` };
    }
    return { payload: await response.json() };
  } catch {
    return { failure: `${provider} could not be reached.` };
  }
};

const fetchGoogleFinanceBridge = async (
  bridgeUrl: string | undefined,
  fetchImplementation: FetchImplementation,
): Promise<Record<string, ProviderQuoteResult>> => {
  const result: Record<string, ProviderQuoteResult> = {};
  const configuredBridgeUrl = bridgeUrl?.trim();
  if (!configuredBridgeUrl) {
    for (const key of Object.keys(GOOGLE_FINANCE_BRIDGE_QUOTES)) {
      result[key] = {
        failure: "Google Finance bridge is not configured. Add GOOGLE_FINANCE_BRIDGE_URL.",
      };
    }
    return result;
  }

  let target: string;
  try {
    target = new URL(configuredBridgeUrl).toString();
  } catch {
    for (const key of Object.keys(GOOGLE_FINANCE_BRIDGE_QUOTES)) {
      result[key] = {
        failure: "GOOGLE_FINANCE_BRIDGE_URL is not a valid URL.",
      };
    }
    return result;
  }

  const response = await readProviderJson(target, "Google Finance bridge", fetchImplementation);
  if ("failure" in response) {
    for (const key of Object.keys(GOOGLE_FINANCE_BRIDGE_QUOTES)) {
      result[key] = response;
    }
    return result;
  }

  const root = asRecord(response.payload);
  const quotes = asRecord(root?.quotes);
  for (const [key, config] of Object.entries(GOOGLE_FINANCE_BRIDGE_QUOTES)) {
    const rawQuote = asRecord(quotes?.[key]);
    const price = positiveFinite(rawQuote?.price);
    const currency = text(rawQuote?.currency).toUpperCase();
    if (!price || currency !== config.currency) {
      result[key] = {
        failure: `Google Finance bridge did not return a valid ${config.currency} quote for ${key}.`,
      };
      continue;
    }
    const quoteTimestamp = text(rawQuote?.quoteTimestamp);
    result[key] = {
      quote: {
        symbol: key,
        price,
        currency: config.currency,
        exchange: config.exchange,
        marketState: "DELAYED",
        ...(quoteTimestamp ? { quoteTimestamp } : {}),
        source: "Google Finance",
        freshness: "delayed",
      },
    };
  }
  return result;
};

const fetchEodhdQuote = async (
  key: string,
  symbol: string,
  apiToken: string | undefined,
  fetchImplementation: FetchImplementation,
): Promise<ProviderQuoteResult> => {
  const token = apiToken?.trim();
  if (!token) {
    return { failure: "EODHD is not configured. Add EODHD_API_TOKEN." };
  }

  const target = new URL(`https://eodhd.com/api/eod/${encodeURIComponent(symbol)}`);
  target.searchParams.set("api_token", token);
  target.searchParams.set("fmt", "json");
  target.searchParams.set("period", "d");
  target.searchParams.set("order", "d");
  target.searchParams.set("from", recentIsoDate());

  const response = await readProviderJson(target.toString(), "EODHD", fetchImplementation);
  if ("failure" in response) return response;
  if (!Array.isArray(response.payload)) {
    return { failure: `EODHD did not return EOD records for ${symbol}.` };
  }

  for (const item of response.payload) {
    const record = asRecord(item);
    const price = positiveFinite(record?.close);
    const quoteTimestamp = quoteTimestampFromEodDate(record?.date);
    if (!price || !quoteTimestamp) continue;
    return {
      quote: {
        symbol,
        price,
        currency: "THB",
        exchange: "SET",
        marketState: "CLOSED",
        quoteTimestamp,
        source: "EODHD",
        freshness: "latest close",
      },
    };
  }

  return { failure: `EODHD did not return a usable latest close for ${key}.` };
};

const refreshHybridMarketQuotes = async (
  environment: MarketApiEnvironment,
  fetchImplementation: FetchImplementation,
): Promise<MarketRefreshPayload> => {
  const [googleQuotes, ...eodhdQuotes] = await Promise.all([
    fetchGoogleFinanceBridge(environment.GOOGLE_FINANCE_BRIDGE_URL, fetchImplementation),
    ...EODHD_THAILAND_QUOTES.map(({ key, symbol }) =>
      fetchEodhdQuote(key, symbol, environment.EODHD_API_TOKEN, fetchImplementation),
    ),
  ]);

  const quotes: Record<string, MarketQuote> = {};
  const failures: Record<string, string> = {};
  for (const [key, result] of Object.entries(googleQuotes)) {
    if ("quote" in result) quotes[key] = result.quote;
    else failures[key] = result.failure;
  }
  for (const [index, result] of eodhdQuotes.entries()) {
    const key = EODHD_THAILAND_QUOTES[index]?.key;
    if (!key) continue;
    if ("quote" in result) quotes[key] = result.quote;
    else failures[key] = result.failure;
  }

  return {
    quotes,
    failures,
    fetchedAt: new Date().toISOString(),
    provider: "Google Finance + EODHD",
  };
};

const refreshMarketQuotes = (
  environment: MarketApiEnvironment,
  fetchImplementation: FetchImplementation,
) =>
  environment.OPENAI_API_KEY?.trim()
    ? refreshOpenAiMarketQuotes(environment, fetchImplementation)
    : refreshHybridMarketQuotes(environment, fetchImplementation);

const fetchYahooQuote = async (
  symbol: string,
  fetchImplementation: FetchImplementation,
  bypassCache = false,
): Promise<YahooQuoteResult> => {
  const cacheKey = `quote:${symbol.toUpperCase()}`;
  const cached = bypassCache ? null : cachedPayload(cacheKey)?.quote;
  if (isMarketQuote(cached)) return { quote: cached };

  const target = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,
  );
  target.searchParams.set("range", "1d");
  target.searchParams.set("interval", "1m");
  target.searchParams.set("includePrePost", "false");

  const result = await readYahooJson(target.toString(), fetchImplementation);
  if ("failure" in result) return result;

  const quote = parseYahooChartQuote(result.payload);
  if (!quote) {
    return {
      failure: {
        error: "Yahoo Finance did not return a usable current quote. Enter a manual price.",
        manualFallback: true,
        status: 404,
      },
    };
  }

  remember(cacheKey, { quote });
  return { quote };
};

const parseBatchSymbols = (rawSymbols: string | null) => {
  if (!rawSymbols) return null;
  const symbols = Array.from(
    new Set(
      rawSymbols
        .split(",")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean),
    ),
  );
  if (
    symbols.length === 0 ||
    symbols.length > 12 ||
    symbols.some((symbol) => !isSafeYahooSymbol(symbol))
  ) {
    return null;
  }
  return symbols;
};

export async function handleMarketApiRequest(
  request: Request,
  fetchImplementation: FetchImplementation = fetch,
  environment: MarketApiEnvironment = {},
): Promise<Response | null> {
  const url = new URL(request.url);
  const isSearch = url.pathname === "/api/market/search";
  const isQuote = url.pathname === "/api/market/quote";
  const isBatchQuote = url.pathname === "/api/market/quotes";
  const isHybridRefresh = url.pathname === "/api/market/refresh";
  if (!isSearch && !isQuote && !isBatchQuote && !isHybridRefresh) return null;

  if (isHybridRefresh) {
    return json(await refreshMarketQuotes(environment, fetchImplementation), 200, "no-store");
  }

  if (isSearch) {
    const query = url.searchParams.get("q")?.trim() ?? "";
    if (!query || query.length > 80) {
      return json({ error: "Enter a company name or ticker up to 80 characters." }, 400);
    }

    const cacheKey = `search:${query.toUpperCase()}`;
    const cached = cachedResponse(cacheKey);
    if (cached) return cached;

    const target = new URL("https://query1.finance.yahoo.com/v1/finance/search");
    target.searchParams.set("q", query);
    target.searchParams.set("quotesCount", "8");
    target.searchParams.set("newsCount", "0");

    const result = await readYahooJson(target.toString(), fetchImplementation);
    if ("failure" in result) {
      return json(result.failure, result.failure.status);
    }

    const body = { candidates: parseYahooSearch(result.payload) };
    remember(cacheKey, body);
    return json(body);
  }

  if (isBatchQuote) {
    const symbols = parseBatchSymbols(url.searchParams.get("symbols"));
    if (!symbols) {
      return json(
        { error: "Enter 1 to 12 valid comma-separated Yahoo Finance symbols." },
        400,
      );
    }

    const results = await Promise.all(
      symbols.map(async (symbol) => ({
        symbol,
        result: await fetchYahooQuote(symbol, fetchImplementation, true),
      })),
    );
    const quotes: Record<string, MarketQuote> = {};
    const failures: Record<string, string> = {};
    for (const { symbol, result } of results) {
      if ("quote" in result) {
        quotes[symbol] = result.quote;
      } else {
        failures[symbol] = result.failure.error;
      }
    }

    return json(
      {
        quotes,
        failures,
        fetchedAt: new Date().toISOString(),
      },
      200,
      "no-store",
    );
  }

  const symbol = url.searchParams.get("symbol")?.trim() ?? "";
  if (!isSafeYahooSymbol(symbol)) {
    return json({ error: "Enter a valid Yahoo Finance symbol." }, 400);
  }

  const result = await fetchYahooQuote(symbol, fetchImplementation);
  if ("failure" in result) {
    return json(result.failure, result.failure.status);
  }
  return json({ quote: result.quote });
}
