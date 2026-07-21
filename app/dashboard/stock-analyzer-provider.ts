import type {
  AnalyzerForwardEps,
  AnalyzerPricePoint,
  AnalyzerValuationPoint,
  StockAnalysisInput,
  StockAnalyzerSource,
} from "./stock-analyzer";

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type StockAnalyzerRuntimeEnv = {
  TIINGO_API_KEY?: string;
  FMP_API_KEY?: string;
};

export class StockAnalyzerProviderError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = "StockAnalyzerProviderError";
  }
}

type ProviderResult = {
  input: StockAnalysisInput;
  source: StockAnalyzerSource;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const numeric = (value: unknown) => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
};

const dateValue = (value: unknown) => {
  if (typeof value !== "string") return null;
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
};

const yearsAgo = (years: number) => {
  const today = new Date();
  today.setUTCFullYear(today.getUTCFullYear() - years);
  return today.toISOString().slice(0, 10);
};

const readJson = async (response: Response, provider: string) => {
  if (!response.ok) {
    throw new StockAnalyzerProviderError(
      `${provider} did not return historical data. Try again later.`,
      response.status === 401 || response.status === 403 ? 503 : 502,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new StockAnalyzerProviderError(`${provider} returned an unreadable response.`);
  }
};

const tiingoPricePoints = (payload: unknown): AnalyzerPricePoint[] => {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const date = dateValue(entry.date);
    const close = numeric(entry.close);
    const adjustedClose = numeric(entry.adjClose ?? entry.adjustedClose ?? entry.close);
    if (!date || !close || close <= 0 || !adjustedClose || adjustedClose <= 0) return [];
    return [{ date, close, adjustedClose }];
  });
};

const flattenRecords = (payload: unknown): Record<string, unknown>[] => {
  if (Array.isArray(payload)) {
    return payload.flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const nested = entry.data;
      return Array.isArray(nested)
        ? [entry, ...nested.filter(isRecord)]
        : [entry];
    });
  }
  if (isRecord(payload)) {
    return Array.isArray(payload.data)
      ? [payload, ...payload.data.filter(isRecord)]
      : [payload];
  }
  return [];
};

const tiingoTrailingPe = (payload: unknown): AnalyzerValuationPoint[] =>
  flattenRecords(payload).flatMap((entry) => {
    const date = dateValue(entry.date ?? entry.asOfDate ?? entry.endDate);
    const value = numeric(entry.peRatio ?? entry.pe_ratio ?? entry.pe);
    if (!date || value === null) return [];
    return [{ date, value }];
  });

const fmpForwardEps = (payload: unknown): AnalyzerForwardEps | undefined => {
  const today = new Date().toISOString().slice(0, 10);
  const candidates = flattenRecords(payload).flatMap((entry) => {
    const value = numeric(
      entry.estimatedEpsAvg ??
        entry.epsAvg ??
        entry.epsEstimated ??
        entry.estimatedEps ??
        entry.eps,
    );
    const yearOnly =
      typeof entry.calendarYear === "string" && /^\d{4}$/.test(entry.calendarYear)
        ? `${entry.calendarYear}-12-31`
        : typeof entry.fiscalYear === "string" && /^\d{4}$/.test(entry.fiscalYear)
          ? `${entry.fiscalYear}-12-31`
          : undefined;
    const asOfDate = dateValue(entry.date ?? yearOnly);
    if (!value || value <= 0 || !asOfDate) return [];
    return [{
      value,
      period: typeof entry.period === "string" ? entry.period : "next annual estimate",
      asOfDate,
      source: "FMP analyst estimates",
    }];
  });
  return candidates
    .filter((candidate) => candidate.asOfDate >= today)
    .sort((left, right) => left.asOfDate.localeCompare(right.asOfDate))[0];
};

const tiingoHeaders = (key: string): HeadersInit => ({
  accept: "application/json",
  authorization: `Token ${key}`,
});

export async function fetchStockAnalyzerInput(
  ticker: string,
  env: StockAnalyzerRuntimeEnv,
  fetchImplementation: FetchImplementation = fetch,
): Promise<ProviderResult> {
  const tiingoKey = env.TIINGO_API_KEY?.trim();
  if (!tiingoKey) {
    throw new StockAnalyzerProviderError(
      "TIINGO_API_KEY is not configured. Cached analysis remains available.",
      503,
    );
  }

  const normalizedTicker = ticker.trim().toUpperCase();
  const startDate = yearsAgo(15);
  const endDate = new Date().toISOString().slice(0, 10);
  const priceUrl = new URL(
    `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(normalizedTicker)}/prices`,
  );
  priceUrl.searchParams.set("startDate", startDate);
  priceUrl.searchParams.set("endDate", endDate);
  priceUrl.searchParams.set("format", "json");
  priceUrl.searchParams.set("resampleFreq", "daily");

  const pricePayload = await readJson(
    await fetchImplementation(priceUrl, { headers: tiingoHeaders(tiingoKey) }),
    "Tiingo EOD",
  );
  const prices = tiingoPricePoints(pricePayload);
  if (!prices.length) {
    throw new StockAnalyzerProviderError(
      "Tiingo EOD returned no usable prices for this ticker.",
      502,
    );
  }

  const warnings: string[] = [];
  let trailingPe: AnalyzerValuationPoint[] = [];
  try {
    const fundamentalsUrl = new URL(
      `https://api.tiingo.com/tiingo/fundamentals/${encodeURIComponent(normalizedTicker)}/daily`,
    );
    fundamentalsUrl.searchParams.set("startDate", startDate);
    fundamentalsUrl.searchParams.set("endDate", endDate);
    const fundamentalsPayload = await readJson(
      await fetchImplementation(fundamentalsUrl, { headers: tiingoHeaders(tiingoKey) }),
      "Tiingo Fundamentals",
    );
    trailingPe = tiingoTrailingPe(fundamentalsPayload);
    if (!trailingPe.length) {
      warnings.push("Historical P/E was not returned by Tiingo Fundamentals for this ticker.");
    }
  } catch {
    warnings.push("Historical P/E is unavailable from the current Tiingo Fundamentals entitlement.");
  }

  let forwardEps: AnalyzerForwardEps | undefined;
  const fmpKey = env.FMP_API_KEY?.trim();
  if (fmpKey) {
    try {
      const estimateUrl = new URL("https://financialmodelingprep.com/stable/analyst-estimates");
      estimateUrl.searchParams.set("symbol", normalizedTicker);
      estimateUrl.searchParams.set("period", "annual");
      estimateUrl.searchParams.set("page", "0");
      estimateUrl.searchParams.set("limit", "5");
      estimateUrl.searchParams.set("apikey", fmpKey);
      const estimatesPayload = await readJson(
        await fetchImplementation(estimateUrl, { headers: { accept: "application/json" } }),
        "FMP analyst estimates",
      );
      forwardEps = fmpForwardEps(estimatesPayload);
      if (!forwardEps) {
        warnings.push("FMP did not return a positive annual EPS estimate for current Forward P/E.");
      }
    } catch {
      warnings.push("Current Forward P/E is unavailable from FMP analyst estimates.");
    }
  } else {
    warnings.push("Set FMP_API_KEY to add current consensus Forward P/E.");
  }

  const fetchedAt = new Date().toISOString();
  return {
    input: {
      ticker: normalizedTicker,
      currency: "USD",
      fetchedAt,
      prices,
      trailingPe,
      ...(forwardEps ? { forwardEps } : {}),
    },
    source: {
      price: "Tiingo EOD",
      trailingPe: trailingPe.length ? "Tiingo Fundamentals" : "Unavailable",
      forwardPe: forwardEps ? "FMP analyst estimates" : "Unavailable",
      ...(warnings.length ? { warnings } : {}),
    },
  };
}
