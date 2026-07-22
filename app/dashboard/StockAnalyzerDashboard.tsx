"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";

import {
  buildStockAnalysis,
  type AveragePoint,
  type StockAnalyzerSnapshot,
} from "./stock-analyzer";
import {
  searchUsSymbolHints,
  type UsStockSymbolHint,
} from "./us-stock-symbol-search";
import {
  buildLineChartGeometry,
  formatChartTooltipDate,
  nearestLineChartPointIndex,
  type LineChartPoint,
} from "./stock-chart";
import {
  PRICE_CHART_RANGES,
  selectPriceRange,
  type PriceChartRange,
} from "./stock-chart-range";

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
  yAxisLabel = "Price (USD)",
}: {
  title: string;
  subtitle: string;
  points: LineChartPoint[];
  formatter?: (value: number) => string;
  tone?: "meadow" | "sky" | "gold";
  yAxisLabel?: string;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
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

  const geometry = buildLineChartGeometry(sampled);
  const linePoints = geometry.coordinates
    .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(" ");
  const area = `${geometry.plotLeft},${geometry.plotBottom} ${linePoints} ${geometry.plotRight},${geometry.plotBottom}`;
  const hovered = hoveredIndex === null ? null : geometry.coordinates[hoveredIndex] ?? null;
  const tooltipWidth = 154;
  const tooltipHeight = 48;
  const tooltipX = hovered
    ? Math.min(
        Math.max(hovered.x - tooltipWidth / 2, geometry.plotLeft),
        geometry.plotRight - tooltipWidth,
      )
    : 0;
  const tooltipY = hovered
    ? hovered.y < geometry.plotTop + tooltipHeight + 12
      ? hovered.y + 12
      : hovered.y - tooltipHeight - 12
    : 0;
  const priceTagWidth = 74;
  const priceTagHeight = 24;
  const priceTagY = hovered
    ? Math.min(
        Math.max(hovered.y - priceTagHeight / 2, geometry.plotTop),
        geometry.plotBottom - priceTagHeight,
      )
    : 0;
  const gradientId = `analyzer-fill-${tone}-${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;

  const updateHoveredPoint = (event: ReactPointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    setHoveredIndex(
      nearestLineChartPointIndex({
        clientX: event.clientX,
        rectLeft: bounds.left,
        rectWidth: bounds.width,
        geometry,
      }),
    );
  };

  return (
    <section className={`analyzer-chart analyzer-chart-${tone}`} aria-label={title}>
      <div className="analyzer-chart-heading">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <strong>{formatter(sampled.at(-1)!.value)}</strong>
      </div>
      <svg
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        role="img"
        aria-label={`${title} line chart. X axis is date. Y axis is ${yAxisLabel}.${hovered ? ` ${formatChartTooltipDate(hovered.point.label)}: ${formatter(hovered.point.value)}.` : ""}`}
        onPointerMove={updateHoveredPoint}
        onPointerDown={updateHoveredPoint}
        onPointerLeave={(event) => {
          if (event.pointerType !== "touch") setHoveredIndex(null);
        }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.32" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.015" />
          </linearGradient>
        </defs>
        {geometry.yTicks.map((tick) => (
          <g key={tick.value} className="analyzer-chart-y-tick">
            <line
              x1={geometry.plotLeft}
              x2={geometry.plotRight}
              y1={tick.y}
              y2={tick.y}
              className="analyzer-chart-grid-line"
            />
            <text
              x={geometry.yAxisX}
              y={tick.y + 4}
              textAnchor="start"
              className="analyzer-chart-axis-tick"
            >
              {formatter(tick.value)}
            </text>
          </g>
        ))}
        <line
          x1={geometry.plotLeft}
          x2={geometry.plotRight}
          y1={geometry.plotBottom}
          y2={geometry.plotBottom}
          className="analyzer-chart-baseline"
        />
        <line
          x1={geometry.plotRight}
          x2={geometry.plotRight}
          y1={geometry.plotTop}
          y2={geometry.plotBottom}
          className="analyzer-chart-baseline"
        />
        <polygon points={area} fill={`url(#${gradientId})`} />
        <polyline
          points={linePoints}
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle
          cx={geometry.coordinates.at(-1)!.x}
          cy={geometry.coordinates.at(-1)!.y}
          r="5"
          className="analyzer-chart-endpoint"
        />
        {geometry.xTicks.map((tick) => (
          <g key={`${tick.label}-${tick.index}`} className="analyzer-chart-x-tick">
            <line
              x1={tick.x}
              x2={tick.x}
              y1={geometry.plotBottom}
              y2={geometry.plotBottom + 5}
              className="analyzer-chart-baseline"
            />
            <text
              x={tick.x}
              y={geometry.plotBottom + 23}
              textAnchor="middle"
              className="analyzer-chart-axis-tick"
            >
              {tick.label}
            </text>
          </g>
        ))}
        <text
          x={geometry.plotLeft + (geometry.plotRight - geometry.plotLeft) / 2}
          y={geometry.height - 5}
          textAnchor="middle"
          className="analyzer-chart-axis-label"
        >
          Date
        </text>
        <text x={geometry.yAxisX} y={geometry.plotTop - 6} className="analyzer-chart-axis-label">
          {yAxisLabel}
        </text>
        {hovered ? (
          <g className="analyzer-chart-hover-tooltip" pointerEvents="none">
            <line
              x1={hovered.x}
              x2={hovered.x}
              y1={geometry.plotTop}
              y2={geometry.plotBottom}
              className="analyzer-chart-hover-line"
            />
            <line
              x1={geometry.plotLeft}
              x2={geometry.plotRight}
              y1={hovered.y}
              y2={hovered.y}
              className="analyzer-chart-hover-line"
            />
            <circle cx={hovered.x} cy={hovered.y} r="6" className="analyzer-chart-hover-dot" />
            <g
              className="analyzer-chart-hover-price-tag"
              transform={`translate(${geometry.yAxisX - 4} ${priceTagY})`}
            >
              <rect width={priceTagWidth} height={priceTagHeight} rx="7" />
              <text x={priceTagWidth / 2} y="16" textAnchor="middle">
                {formatter(hovered.point.value)}
              </text>
            </g>
            <g transform={`translate(${tooltipX} ${tooltipY})`}>
              <rect width={tooltipWidth} height={tooltipHeight} rx="9" />
              <text x="10" y="18" className="analyzer-chart-hover-date">
                {formatChartTooltipDate(hovered.point.label)}
              </text>
              <text x="10" y="37" className="analyzer-chart-hover-value">
                {formatter(hovered.point.value)}
              </text>
            </g>
          </g>
        ) : null}
      </svg>
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
  const [tickerInput, setTickerInput] = useState("");
  const [isHintOpen, setIsHintOpen] = useState(false);
  const [activeHintIndex, setActiveHintIndex] = useState(-1);
  const [snapshot, setSnapshot] = useState<StockAnalyzerSnapshot | null>(null);
  const [range, setRange] = useState<PriceChartRange>("15Y");
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
    setIsHintOpen(false);
    setActiveHintIndex(-1);
    if (!safeTicker(ticker)) {
      setError("Choose a suggestion, or enter a normal U.S. ticker such as AMZN, MSFT, META, or BRK.B.");
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

  const tickerHints = useMemo(
    () => searchUsSymbolHints(tickerInput, 8),
    [tickerInput],
  );
  const hintListOpen = isHintOpen && tickerInput.trim().length > 0 && tickerHints.length > 0;
  const activeHint = activeHintIndex >= 0 ? tickerHints[activeHintIndex] : undefined;

  const chooseHint = (hint: UsStockSymbolHint) => {
    setTickerInput(hint.symbol);
    setIsHintOpen(false);
    setActiveHintIndex(-1);
    setError(null);
  };

  const handleTickerKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!tickerHints.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIsHintOpen(true);
      setActiveHintIndex((index) => (index + 1) % tickerHints.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setIsHintOpen(true);
      setActiveHintIndex((index) => (index <= 0 ? tickerHints.length - 1 : index - 1));
      return;
    }

    if (event.key === "Enter" && hintListOpen && activeHint) {
      event.preventDefault();
      chooseHint(activeHint);
      return;
    }

    if (event.key === "Escape") {
      setIsHintOpen(false);
      setActiveHintIndex(-1);
    }
  };

  const analysis = useMemo(
    () => snapshot?.analysis ?? (snapshot ? buildStockAnalysis(snapshot.input) : null),
    [snapshot],
  );
  const rangePrices = useMemo(
    () => (analysis ? selectPriceRange(analysis.priceSeries, range) : []),
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
            <label htmlFor="analyzer-ticker">U.S. ticker or company</label>
            <div className="analyzer-symbol-search">
              <div className="analyzer-symbol-combobox">
                <input
                  id="analyzer-ticker"
                  value={tickerInput}
                  onChange={(event) => {
                    setTickerInput(event.target.value);
                    setIsHintOpen(true);
                    setActiveHintIndex(-1);
                  }}
                  onFocus={() => setIsHintOpen(tickerInput.trim().length > 0)}
                  onBlur={(event) => {
                    const nextTarget = event.relatedTarget;
                    if (!(nextTarget instanceof HTMLElement) || !nextTarget.closest(".analyzer-symbol-combobox")) {
                      setIsHintOpen(false);
                      setActiveHintIndex(-1);
                    }
                  }}
                  onKeyDown={handleTickerKeyDown}
                  placeholder="Search U.S. ticker or company"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck="false"
                  maxLength={80}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-controls="analyzer-ticker-hints"
                  aria-expanded={hintListOpen}
                  aria-activedescendant={activeHint ? `analyzer-hint-${activeHint.symbol}` : undefined}
                  aria-describedby="analyzer-ticker-help"
                />
                {hintListOpen ? (
                  <ul id="analyzer-ticker-hints" className="analyzer-symbol-hints" role="listbox" aria-label="Matching U.S. tickers">
                    {tickerHints.map((hint, index) => (
                      <li key={hint.symbol}>
                        <button
                          id={`analyzer-hint-${hint.symbol}`}
                          type="button"
                          role="option"
                          aria-selected={index === activeHintIndex}
                          className={index === activeHintIndex ? "active" : ""}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            chooseHint(hint);
                          }}
                        >
                          <strong>{hint.symbol}</strong>
                          <span>{hint.name}</span>
                          <small>{hint.exchange}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <button className="button button-primary" type="submit" disabled={isRefreshing}>
                {isRefreshing ? "Refreshing…" : "Refresh analysis"}
              </button>
            </div>
            <small id="analyzer-ticker-help">Search by ticker or company name, choose a hint, then refresh one ticker at a time.</small>
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
                  {PRICE_CHART_RANGES.map((option) => (
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
                yAxisLabel="Price (USD)"
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
                yAxisLabel="Price (USD)"
              />
              <LineChart
                title="Historical trailing P/E"
                subtitle="Latest observed positive P/E in each year; negative earnings are N/M."
                points={historicalPe}
                formatter={(value) => `${rounded.format(value)}×`}
                tone="gold"
                yAxisLabel="P/E (×)"
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
