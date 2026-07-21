"use client";

import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";

import {
  buildStockAnalysis,
  type AnalyzerPricePoint,
  type AveragePoint,
  type StockAnalyzerSnapshot,
} from "./stock-analyzer";

type Range = "1Y" | "5Y" | "10Y" | "15Y";

type ChartPoint = {
  label: string;
  value: number;
};

const RANGE_YEARS: Record<Range, number> = {
  "1Y": 1,
  "5Y": 5,
  "10Y": 10,
  "15Y": 15,
};

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const rounded = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});

const integer = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const percentage = (value: number | null) =>
  value === null || !Number.isFinite(value)
    ? "—"
    : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;

const safeTicker = (value: string) => /^[A-Za-z][A-Za-z0-9.-]{0,11}$/.test(value.trim());

const formatDate = (value: string) => {
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(date);
};

const formatFetchedAt = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Bangkok",
      }).format(date);
};

const targetDate = (latestDate: string, years: number) => {
  const latest = new Date(`${latestDate}T00:00:00.000Z`);
  latest.setUTCFullYear(latest.getUTCFullYear() - years);
  return latest.toISOString().slice(0, 10);
};

const selectedPrices = (prices: AnalyzerPricePoint[], range: Range) => {
  if (!prices.length) return [];
  const cutoff = targetDate(prices.at(-1)!.date, RANGE_YEARS[range]);
  return prices.filter((point) => point.date >= cutoff);
};

const downsample = <T,>(values: T[], maxPoints = 360) => {
  if (values.length <= maxPoints) return values;
  const step = (values.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, index) => values[Math.round(index * step)]!);
};

function LineChart({
  title,
  subtitle,
  points,
  formatter = currency.format,
  tone = "meadow",
}: {
  title: string;
  subtitle: string;
  points: ChartPoint[];
  formatter?: (value: number) => string;
  tone?: "meadow" | "sky" | "gold";
}) {
  const sampled = downsample(points);
  if (!sampled.length) {
    return (
      <section className="analyzer-chart analyzer-chart-empty" aria-label={`${title} unavailable`}>
        <h3>{title}</h3>
        <p>{subtitle}</p>
        <strong>Unavailable for this ticker</strong>
      </section>
    );
  }

  const values = sampled.map((point) => point.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const spread = maximum - minimum || Math.max(maximum * 0.04, 1);
  const width = 720;
  const height = 240;
  const padding = 18;
  const coordinates = sampled.map((point, index) => {
    const x = padding + (index / Math.max(sampled.length - 1, 1)) * (width - padding * 2);
    const y = height - padding - ((point.value - minimum) / spread) * (height - padding * 2);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const area = `${padding},${height - padding} ${coordinates.join(" ")} ${width - padding},${height - padding}`;

  return (
    <section className={`analyzer-chart analyzer-chart-${tone}`} aria-label={title}>
      <div className="analyzer-chart-heading">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <strong>{formatter(sampled.at(-1)!.value)}</strong>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title} line chart`}>
        <defs>
          <linearGradient id={`analyzer-fill-${tone}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.32" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.015" />
          </linearGradient>
        </defs>
        <line x1={padding} x2={width - padding} y1={height - padding} y2={height - padding} className="analyzer-chart-baseline" />
        <polygon points={area} fill={`url(#analyzer-fill-${tone})`} />
        <polyline points={coordinates.join(" ")} fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
        <circle
          cx={coordinates.at(-1)!.split(",")[0]}
          cy={coordinates.at(-1)!.split(",")[1]}
          r="5"
          className="analyzer-chart-endpoint"
        />
      </svg>
      <div className="analyzer-chart-axis" aria-hidden="true">
        <span>{sampled[0]!.label}</span>
        <span>{formatter(minimum)}</span>
        <span>{formatter(maximum)}</span>
        <span>{sampled.at(-1)!.label}</span>
      </div>
    </section>
  );
}

function AverageList({
  title,
  detail,
  rows,
  maxRows,
}: {
  title: string;
  detail: string;
  rows: AveragePoint[];
  maxRows: number;
}) {
  const visible = rows.slice(-maxRows).reverse();
  return (
    <section className="analyzer-average-card">
      <div>
        <h3>{title}</h3>
        <p>{detail}</p>
      </div>
      <div className="analyzer-average-rows">
        {visible.map((row) => (
          <div key={row.period}>
            <span>{row.period}</span>
            <strong>{currency.format(row.adjustedAverage)}</strong>
            <small>{integer.format(row.observations)} days</small>
          </div>
        ))}
      </div>
    </section>
  );
}

const responseError = async (response: Response) => {
  try {
    const body = await response.json() as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // Use the safe fallback below when a proxy returns non-JSON.
  }
  return `Request failed (${response.status}).`;
};

export function StockAnalyzerDashboard() {
  const [tickerInput, setTickerInput] = useState("GOOGL");
  const [snapshot, setSnapshot] = useState<StockAnalyzerSnapshot | null>(null);
  const [range, setRange] = useState<Range>("15Y");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [notice, setNotice] = useState("Loading the latest saved analysis…");
  const [error, setError] = useState<string | null>(null);

  const loadCachedSnapshot = async (ticker: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/analyzer?symbol=${encodeURIComponent(ticker)}`);
      if (!response.ok) {
        setSnapshot(null);
        setNotice(await responseError(response));
        return;
      }
      const next = await response.json() as StockAnalyzerSnapshot;
      setSnapshot(next);
      setTickerInput(next.ticker);
      setNotice(`Showing the persisted snapshot from ${formatFetchedAt(next.fetchedAt)} Bangkok time.`);
    } catch {
      setSnapshot(null);
      setNotice("The saved analysis could not be reached. Check the Railway database connection.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    queueMicrotask(() => {
      void loadCachedSnapshot("GOOGL");
    });
  }, []);

  const requestAnalysis = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const ticker = tickerInput.trim().toUpperCase();
    if (!safeTicker(ticker)) {
      setError("Use a normal U.S. ticker, such as GOOGL, MSFT, AMZN, META, or BRK.B.");
      return;
    }
    setIsRefreshing(true);
    setError(null);
    try {
      const response = await fetch("/api/analyzer/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol: ticker }),
      });
      if (!response.ok) {
        throw new Error(await responseError(response));
      }
      const next = await response.json() as StockAnalyzerSnapshot;
      setSnapshot(next);
      setTickerInput(next.ticker);
      setNotice(`Saved a fresh ${next.ticker} snapshot at ${formatFetchedAt(next.fetchedAt)} Bangkok time.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Analysis refresh failed.");
    } finally {
      setIsRefreshing(false);
    }
  };

  const analysis = useMemo(
    () => snapshot?.analysis ?? (snapshot ? buildStockAnalysis(snapshot.input) : null),
    [snapshot],
  );
  const rangePrices = useMemo(
    () => (analysis ? selectedPrices(analysis.priceSeries, range) : []),
    [analysis, range],
  );
  const priceChart = rangePrices.map((point) => ({ label: point.date, value: point.adjustedClose }));
  const annualPriceChart = (analysis?.annualAverages ?? []).map((point) => ({
    label: point.period,
    value: point.adjustedAverage,
  }));
  const historicalPe = (analysis?.annualPe ?? [])
    .filter((point): point is typeof point & { value: number } => point.value !== null)
    .map((point) => ({ label: String(point.year), value: point.value }));
  const latestTrailingPe = analysis?.annualPe.at(-1)?.value ?? null;

  return (
    <main className="dashboard-shell ghibli-countryside-ledger stock-analyzer-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand-cluster">
            <div className="brand-mark" aria-hidden="true">SA</div>
            <div>
              <p className="eyebrow">PRIVATE RESEARCH GARDEN</p>
              <h1>Stock Analyzer</h1>
            </div>
          </div>
          <Link className="button button-secondary analyzer-link" href="/">Portfolio audit</Link>
        </div>
      </header>

      <div className="dashboard-container analyzer-container">
        <section className="analyzer-hero panel">
          <div>
            <p className="eyebrow">U.S. EQUITY RESEARCH</p>
            <h2>ย้อนหลัง 15 ปี โดยไม่ปนกับ Excel audit</h2>
            <p>
              ราคาย้อนหลัง, average, CAGR และ valuation snapshot ถูกเก็บแยกใน Railway
              ส่วน Excel ยังคงเก็บเฉพาะหุ้นที่ถือ, ราคาที่เข้า และจำนวนหน่วย.
            </p>
          </div>
          <form className="analyzer-ticker-form" onSubmit={requestAnalysis}>
            <label htmlFor="analyzer-ticker">U.S. ticker</label>
            <div>
              <input
                id="analyzer-ticker"
                value={tickerInput}
                onChange={(event) => setTickerInput(event.target.value.toUpperCase())}
                placeholder="GOOGL"
                autoCapitalize="characters"
                spellCheck="false"
                maxLength={12}
              />
              <button className="button button-primary" type="submit" disabled={isRefreshing}>
                {isRefreshing ? "Refreshing…" : "Refresh analysis"}
              </button>
            </div>
            <small>Refresh one ticker at a time. The newest successful snapshot stays until the next refresh.</small>
          </form>
        </section>

        <section className={`analyzer-status ${error ? "error" : ""}`} aria-live="polite">
          <span aria-hidden="true" />
          <div>
            <strong>{error ? "Could not refresh analysis" : "Snapshot status"}</strong>
            <p>{error ?? notice}</p>
          </div>
        </section>

        {isLoading ? (
          <section className="panel analyzer-empty-state"><h2>Loading saved research…</h2></section>
        ) : !analysis || !snapshot ? (
          <section className="panel analyzer-empty-state">
            <p className="eyebrow">NO CACHED SNAPSHOT</p>
            <h2>Refresh a ticker once to begin.</h2>
            <p>
              This page will show a saved result after the server-side market-data credential and Railway
              PostgreSQL are configured. No API credential is ever sent to this browser.
            </p>
          </section>
        ) : (
          <>
            <section className="analyzer-overview-grid" aria-label="Stock Analyzer summary">
              <article className="panel analyzer-price-card">
                <p className="eyebrow">LATEST EOD CLOSE</p>
                <strong>{currency.format(analysis.currentPrice)}</strong>
                <span>{snapshot.ticker} · {formatDate(analysis.currentPriceDate)}</span>
              </article>
              <article className="panel analyzer-coverage-card">
                <p className="eyebrow">COVERAGE</p>
                <strong>{formatDate(analysis.coverage.startDate)} → {formatDate(analysis.coverage.endDate)}</strong>
                <span>{integer.format(analysis.coverage.observations)} EOD observations · {snapshot.source.price}</span>
              </article>
              <article className="panel analyzer-pe-card">
                <p className="eyebrow">LATEST TRAILING P/E</p>
                <strong>{latestTrailingPe === null ? "N/M" : `${rounded.format(latestTrailingPe)}×`}</strong>
                <span>{snapshot.source.trailingPe}</span>
              </article>
            </section>

            <section className="panel analyzer-performance-panel">
              <div className="section-title analyzer-section-title">
                <div>
                  <p className="eyebrow">PRICE BEHAVIOUR</p>
                  <h2>{snapshot.ticker} · split-adjusted close</h2>
                </div>
                <div className="analyzer-range-controls" aria-label="Price-chart time range">
                  {(Object.keys(RANGE_YEARS) as Range[]).map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={range === option ? "active" : ""}
                      onClick={() => setRange(option)}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
              <LineChart
                title={`${range} adjusted-close trend`}
                subtitle="Dividend- and split-adjusted market data. The visual is downsampled only for drawing."
                points={priceChart}
              />
              <div className="analyzer-cagr-grid" aria-label="CAGR summary">
                {([5, 10, 15] as const).map((horizon) => (
                  <article key={horizon}>
                    <span>{horizon}-year total-return CAGR</span>
                    <strong>{percentage(analysis.cagr.totalReturn[horizon])}</strong>
                    <small>
                      from {analysis.cagr.startDates[horizon] ? formatDate(analysis.cagr.startDates[horizon]!) : "insufficient history"}
                    </small>
                  </article>
                ))}
              </div>
            </section>

            <section className="analyzer-data-grid">
              <LineChart
                title="Annual average price"
                subtitle="Arithmetic mean of daily split-adjusted closes."
                points={annualPriceChart}
                tone="sky"
              />
              <LineChart
                title="Historical trailing P/E"
                subtitle="Latest observed positive P/E in each year; negative earnings are N/M."
                points={historicalPe}
                formatter={(value) => `${rounded.format(value)}×`}
                tone="gold"
              />
            </section>

            <section className="analyzer-data-grid">
              <AverageList
                title="Monthly average price"
                detail="Latest 12 months, using daily split-adjusted closes."
                rows={analysis.monthlyAverages}
                maxRows={12}
              />
              <AverageList
                title="Annual average price"
                detail="Latest 15 calendar years, using daily split-adjusted closes."
                rows={analysis.annualAverages}
                maxRows={15}
              />
            </section>

            <section className="panel analyzer-valuation-panel">
              <div>
                <p className="eyebrow">VALUATION BOUNDARY</p>
                <h2>Forward P/E is shown honestly</h2>
                <p>
                  Historical Forward P/E is intentionally not inferred from current consensus estimates.
                  It needs a licensed point-in-time estimates source to avoid look-ahead bias.
                </p>
              </div>
              <div className="analyzer-forward-pe">
                <span>Current Forward P/E</span>
                <strong>{analysis.forwardPe.current === null ? "Unavailable" : `${rounded.format(analysis.forwardPe.current)}×`}</strong>
                <small>{analysis.forwardPe.status}</small>
                {analysis.forwardPe.source ? <small>Source: {analysis.forwardPe.source}</small> : null}
              </div>
            </section>

            <section className="analyzer-source-panel panel">
              <div>
                <p className="eyebrow">SAVED SNAPSHOT</p>
                <h2>Sources and data quality</h2>
              </div>
              <dl>
                <div><dt>Price</dt><dd>{snapshot.source.price}</dd></div>
                <div><dt>Trailing P/E</dt><dd>{snapshot.source.trailingPe}</dd></div>
                <div><dt>Forward P/E</dt><dd>{snapshot.source.forwardPe}</dd></div>
                <div><dt>Saved</dt><dd>{formatFetchedAt(snapshot.fetchedAt)} Bangkok time</dd></div>
              </dl>
              {snapshot.source.warnings?.length ? (
                <ul>
                  {snapshot.source.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              ) : null}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
