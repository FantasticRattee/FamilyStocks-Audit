import {
  buildStockAnalysis,
  isSafeAnalyzerTicker,
  type StockAnalyzerSnapshot,
} from "./stock-analyzer";
import {
  fetchStockAnalyzerInput,
  StockAnalyzerProviderError,
  type StockAnalyzerRuntimeEnv,
} from "./stock-analyzer-provider";

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type { StockAnalyzerSnapshot } from "./stock-analyzer";

export interface StockAnalyzerRepository {
  loadStockAnalyzerSnapshot(ticker: string): Promise<StockAnalyzerSnapshot | null>;
  saveStockAnalyzerSnapshot(snapshot: StockAnalyzerSnapshot): Promise<StockAnalyzerSnapshot>;
}

const jsonResponse = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });

const readSymbol = (value: unknown) =>
  typeof value === "string" ? value.trim().toUpperCase() : "";

const requestBody = async (request: Request) => {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
};

export async function handleStockAnalyzerApiRequest(
  request: Request,
  env: StockAnalyzerRuntimeEnv,
  repository: StockAnalyzerRepository,
  fetchImplementation: FetchImplementation = fetch,
): Promise<Response | null> {
  const url = new URL(request.url);
  const isRead = url.pathname === "/api/analyzer";
  const isRefresh = url.pathname === "/api/analyzer/refresh";
  if (!isRead && !isRefresh) return null;

  if (isRead) {
    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed." }, 405, { allow: "GET" });
    }
    const ticker = readSymbol(url.searchParams.get("symbol"));
    if (!isSafeAnalyzerTicker(ticker)) {
      return jsonResponse({ error: "A valid U.S. ticker symbol is required." }, 400);
    }
    try {
      const snapshot = await repository.loadStockAnalyzerSnapshot(ticker);
      if (!snapshot) {
        return jsonResponse(
          { error: "No cached analysis exists for this ticker. Refresh it once to create a snapshot." },
          404,
        );
      }
      return jsonResponse(snapshot);
    } catch {
      return jsonResponse({ error: "Analyzer storage is unavailable." }, 503);
    }
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405, { allow: "POST" });
  }
  const body = await requestBody(request);
  const ticker = readSymbol(body?.symbol);
  if (!isSafeAnalyzerTicker(ticker)) {
    return jsonResponse({ error: "A valid U.S. ticker symbol is required." }, 400);
  }
  if (!env.TIINGO_API_KEY?.trim()) {
    return jsonResponse(
      { error: "TIINGO_API_KEY is not configured. Cached analysis remains available." },
      503,
    );
  }

  try {
    const provider = await fetchStockAnalyzerInput(ticker, env, fetchImplementation);
    const snapshot: StockAnalyzerSnapshot = {
      ticker,
      currency: provider.input.currency,
      fetchedAt: provider.input.fetchedAt,
      source: provider.source,
      input: provider.input,
      analysis: buildStockAnalysis(provider.input),
    };
    return jsonResponse(await repository.saveStockAnalyzerSnapshot(snapshot));
  } catch (error) {
    if (error instanceof StockAnalyzerProviderError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    return jsonResponse({ error: "Analyzer refresh failed before it could be saved." }, 502);
  }
}
