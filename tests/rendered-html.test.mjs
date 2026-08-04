import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker;
}

async function requestWorker(path = "/", init = {}, env = {}) {
  const worker = await loadWorker();

  return worker.fetch(
    new Request(`http://localhost${path}`, init),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
      ...env,
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

async function render() {
  return requestWorker("/", { headers: { accept: "text/html" } });
}

test("server-renders the stock-audit dashboard without a credential prompt", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Stock Audit \| Private Dashboard<\/title>/i);
  assert.match(html, /Stock Audit/i);
  assert.match(html, /Embedded audit snapshot/i);
  assert.match(html, /Import Excel/i);
  assert.doesNotMatch(html, /lock-screen|portfolio-(?:pass)word|>Lock</i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("removes the disposable starter preview from the finished dashboard", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /Dashboard/);
  assert.match(layout, /Stock Audit \| Private Dashboard/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview", templateRoot)));
});

test("uses one fixed local preview port while leaving Railway production dynamic", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );

  assert.match(packageJson.scripts.dev, /vinext dev --port 3001$/);
  assert.doesNotMatch(packageJson.scripts.start, /--port\s+3001/);
});

test("keeps Yahoo selection and minimal Excel export in the finished dashboard source", async () => {
  const [dashboard, worker] = await Promise.all([
    readFile(new URL("../app/dashboard/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  ]);

  assert.match(dashboard, /Save & Download Excel/);
  assert.match(dashboard, /\/api\/market\/search/);
  assert.match(dashboard, /exportMinimalHoldingsWorkbook/);
  assert.match(dashboard, /Ticker, Owner\/Account, Entry Price และ Units/);
  assert.doesNotMatch(dashboard, /Dashboard Audit/);
  assert.doesNotMatch(dashboard, /Export JSON/);
  assert.match(worker, /handleMarketApiRequest\([\s\S]*?portfolioRepository/);
});

test("persists one fresh free-source market refresh in shared PostgreSQL", async () => {
  const [dashboard, marketApi, styles] = await Promise.all([
    readFile(new URL("../app/dashboard/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/market-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(dashboard, /Refresh market prices/);
  assert.match(dashboard, /\/api\/market\/refresh/);
  assert.match(dashboard, /createLiveMarketRefreshPlan/);
  assert.match(dashboard, /applyLiveMarketState/);
  assert.match(dashboard, /Google Finance \+ SET public quotes/);
  assert.match(dashboard, /saved to shared PostgreSQL/);
  assert.match(marketApi, /PUBLIC_MARKET_QUOTES/);
  assert.match(marketApi, /www\.google\.com\/finance/);
  assert.match(marketApi, /www\.set\.or\.th\/en\/market/);
  assert.match(marketApi, /persistMarketRefresh/);
  assert.doesNotMatch(marketApi, /api\.openai\.com|OPENAI_API_KEY|loadRecentMarketRefresh/);
  assert.doesNotMatch(dashboard, /5-minute API cooldown|OpenAI/);
  assert.match(dashboard, /liveMarketState\.sources/);
  assert.doesNotMatch(dashboard, /setInterval\s*\(/);
  assert.match(styles, /\.live-market-status/);
  assert.match(styles, /\.live-market-source-links/);
  assert.match(styles, /\.button-market-refresh/);

  const response = await render();
  const html = await response.text();
  assert.match(html, /Refresh market prices/);
  assert.match(html, /Google Finance \+ SET public quotes/);
  assert.doesNotMatch(html, /OpenAI web search|EODHD/);
});

test("server-renders the approved Family Wealth graph-first overview", async () => {
  const response = await render();
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /Family ownership/i);
  assert.match(html, /Portfolio composition/i);
  assert.match(html, /P&amp;L by ticker/i);
  assert.match(html, /Dividend distribution/i);
  assert.match(html, /aria-label="Family ownership comparison/i);
  assert.match(html, /aria-label="Portfolio composition by ticker/i);
  assert.match(html, /aria-label="Unrealized P&amp;L by ticker/i);
  assert.match(html, /aria-label="Net dividend forecast distribution/i);
  assert.doesNotMatch(html, /portfolio value history|historical performance chart/i);
});

test("shows one reconciled portfolio context across every dashboard tab", async () => {
  const response = await render();
  assert.equal(response.status, 200);

  const [html, dashboard] = await Promise.all([
    response.text(),
    readFile(new URL("../app/dashboard/Dashboard.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(html, /aria-label="Portfolio reconciliation summary"/i);
  assert.match(html, /Portfolio current value/i);
  assert.match(html, /Shared capital · fixed/i);
  assert.match(html, /Current shared assets/i);
  assert.match(
    dashboard,
    /<\/nav>[\s\S]*?className="portfolio-context-strip"[\s\S]*?formatThb\(result\.totals\.marketValue\)[\s\S]*?formatThb\(snapshot\.summary\.sharedCapital\)[\s\S]*?formatThb\(result\.totals\.sharedMarketValue\)/,
  );
  assert.match(dashboard, /<small>SHARED CAPITAL · FIXED<\/small>/);
  assert.match(dashboard, /<span>Current shared assets<\/span>/);
  assert.doesNotMatch(dashboard, /<small>SHARED POOL<\/small>/);
});

test("renders the transaction ledger newest date first without mutating audit rows", async () => {
  const dashboard = await readFile(
    new URL("../app/dashboard/Dashboard.tsx", import.meta.url),
    "utf8",
  );
  const transactionFilter =
    dashboard.match(/const filteredTransactions =[\s\S]*?\n  \};/)?.[0] ?? "";

  assert.match(transactionFilter, /\.filter\(\(transaction\) =>/);
  assert.match(
    transactionFilter,
    /\.sort\(\(left, right\) => right\.date\.localeCompare\(left\.date\)\)/,
  );
  assert.doesNotMatch(transactionFilter, /snapshot\.transactions\.sort\(/);
});

test("renders the approved family portrait hero with one image-derived theme", async () => {
  const response = await render();
  assert.equal(response.status, 200);

  const [html, dashboard, styles] = await Promise.all([
    response.text(),
    readFile(new URL("../app/dashboard/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /class="wealth-hero-artwork"/i);
  assert.match(html, /src="\/family-portfolio-hero\.png"/i);
  assert.match(dashboard, /PORTFOLIO_THEME/);
  assert.match(styles, /--sky:/);
  assert.match(styles, /--meadow:/);
});

test("applies the approved Ghibli Countryside Ledger theme across the full dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);

  const [html, dashboard, styles, readme] = await Promise.all([
    response.text(),
    readFile(new URL("../app/dashboard/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
  ]);

  assert.match(html, /class="dashboard-shell ghibli-countryside-ledger"/i);
  assert.match(styles, /--paper-wash:\s*#f7efdc/i);
  assert.match(styles, /--forest-canopy:\s*#294c38/i);
  assert.match(styles, /\.ghibli-countryside-ledger\s+\.panel::before/i);
  assert.match(styles, /\.ghibli-countryside-ledger\s+\.table-wrap/i);
  assert.match(styles, /\.ghibli-countryside-ledger\s+\.allocation-fallback-ring/i);
  assert.match(dashboard, /PAINTED_CLAY_MATERIAL/);
  assert.match(dashboard, /GHIBLI_SCENE_LIGHTS/);
  assert.match(dashboard, /roughness=\{PAINTED_CLAY_MATERIAL\.roughness\}/);
  assert.match(dashboard, /hemisphereLight[^\n]*GHIBLI_SCENE_LIGHTS\.sky/i);
  assert.match(readme, /Ghibli Countryside Ledger/i);
});

test("uses the family portrait across the full hero while reserving a legible copy area", async () => {
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(styles, /\.wealth-hero-primary\s*\{[^}]*min-height:\s*264px/i);
  assert.match(styles, /\.wealth-hero-artwork\s*\{[^}]*width:\s*100%/i);
  assert.match(styles, /\.wealth-hero-artwork\s*\{[^}]*-webkit-mask-image:\s*none/i);
  assert.match(styles, /\.wealth-hero-artwork\s*\{[^}]*mask-image:\s*none/i);
  assert.match(styles, /\.wealth-hero-artwork::before\s*\{[^}]*rgba\(255, 250, 240, 0\.93\) 0%/i);
  assert.match(styles, /\.wealth-hero-artwork img\s*\{[^}]*width:\s*130%/i);
  assert.match(styles, /\.wealth-hero-artwork img\s*\{[^}]*object-position:\s*50% 13%/i);
  assert.match(styles, /\.wealth-hero-artwork img\s*\{[^}]*transform:\s*translate\(0%, 0%\)/i);
  assert.match(
    styles,
    /\.dividend-total\s*\{[^}]*background:\s*linear-gradient\(135deg,\s*#eff6f0,\s*#dcebe7\)/i,
  );
  assert.match(styles, /\.dividend-total\s*\{[^}]*color:\s*var\(--navy\)/i);
});

test("defines a compact, no-overflow layout for phone-sized Family Wealth views", async () => {
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(styles, /\.dashboard-shell\s*\{[^}]*overflow-x:\s*clip/i);
  assert.match(
    styles,
    /@media \(max-width: 620px\)\s*\{[\s\S]*?\.topbar-inner\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/i,
  );
  assert.match(
    styles,
    /@media \(max-width: 390px\)\s*\{[\s\S]*?\.composition-3d-stage\s*\{[\s\S]*?min-height:\s*270px/i,
  );
  assert.match(
    styles,
    /@media \(max-width: 520px\)\s*\{[\s\S]*?\.wealth-hero-artwork\s*\{[^}]*width:\s*100%/i,
  );
  assert.match(
    styles,
    /@media \(max-width: 520px\)\s*\{[\s\S]*?\.wealth-hero-artwork img\s*\{[^}]*width:\s*100%[^}]*height:\s*100%[^}]*object-fit:\s*cover/i,
  );
  assert.match(
    styles,
    /@media \(max-width: 360px\)\s*\{[\s\S]*?\.topbar-actions\s*\{[\s\S]*?grid-template-columns:\s*1fr/i,
  );
  assert.match(styles, /\.tabs::-webkit-scrollbar\s*\{[^}]*display:\s*none/i);
});

test("server-renders Plan A as an accessible interactive 3D allocation ring", async () => {
  const response = await render();
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /Interactive 3D portfolio composition ring/i);
  assert.doesNotMatch(html, /Hover, tap, or focus a ticker/i);
  assert.match(html, /aria-label="Select .* allocation/i);
  assert.match(html, /shared-pool-badge/i);
  assert.doesNotMatch(html, /class="ticker-donut"/i);
});

test("keeps the approved R3F runtime, demand rendering, and motion fallback", async () => {
  const [dashboard, styles, packageJson] = await Promise.all([
    readFile(new URL("../app/dashboard/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(dashboard, /@react-three\/fiber/);
  assert.match(dashboard, /@react-three\/drei/);
  assert.match(dashboard, /frameloop="demand"/);
  assert.match(dashboard, /shadows="basic"/);
  assert.match(dashboard, /onPointerOver/);
  assert.match(dashboard, /onFocus/);
  assert.match(dashboard, /<button\s+className=\{`allocation-fallback-ring/);
  assert.match(dashboard, /onClick=\{activateNextAllocation\}/);
  assert.match(dashboard, /fallback=\{null\}/);
  assert.doesNotMatch(dashboard, /3D preview unavailable/);
  assert.match(
    dashboard,
    /className=\{`composition-3d-stage \$\{canvasReady \? "canvas-ready" : ""\}`\}/,
  );
  assert.match(
    styles,
    /\.composition-3d-stage canvas\s*\{[^}]*touch-action:\s*pan-y/i,
  );
  assert.match(
    styles,
    /\.composition-3d-stage:not\(\.canvas-ready\) canvas\s*\{[^}]*pointer-events:\s*none/i,
  );
  assert.match(styles, /prefers-reduced-motion:\s*reduce/i);
  assert.match(packageJson, /"@react-three\/fiber"/);
  assert.match(packageJson, /"@react-three\/drei"/);
  assert.match(packageJson, /"three"/);
});

test("keeps ownership in 3D while P&L and dividend use normal bars", async () => {
  const response = await render();
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /Interactive 3D family ownership bars/i);
  assert.doesNotMatch(html, /Interactive 3D unrealized P&amp;L bars/i);
  assert.doesNotMatch(html, /Interactive 3D net dividend forecast bars/i);
  assert.match(html, /class="ownership-chart"/i);
  assert.match(html, /class="pnl-chart"/i);
  assert.match(html, /class="dividend-owner-chart"/i);
  assert.match(html, /class="compact-r3f-bar-field ownership-r3f-bars"/i);
  assert.match(html, /class="pnl-row-bars"/i);
  assert.doesNotMatch(html, /class="compact-r3f-bar-field pnl-r3f-bars"/i);
  assert.match(html, /class="dividend-owner-row"/i);
  assert.match(html, /class="dividend-track"/i);
  assert.doesNotMatch(html, /class="compact-r3f-bar-field dividend-r3f-bars"/i);
  assert.doesNotMatch(
    html,
    /bar3d-stage|bar3d-controls|bar3d-stage-readout|bar3d-interaction-hint|bar3d-selection/i,
  );
});

test("sizes the P&L chart from its active ticker count", async () => {
  const response = await render();
  assert.equal(response.status, 200);

  const html = await response.text();
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(html, /class="pnl-compact-grid" style="--pnl-row-count:7"/i);
  assert.match(
    styles,
    /\.pnl-row-bars,[\s\S]*?height:\s*calc\(var\(--pnl-row-count,\s*3\)\s*\*\s*36px\)/i,
  );
  assert.match(
    styles,
    /grid-template-rows:\s*repeat\(var\(--pnl-row-count,\s*3\),\s*minmax\(0,\s*1fr\)\)/i,
  );
});

test("uses one reusable demand-rendered compact R3F bar-field implementation", async () => {
  const dashboard = await readFile(
    new URL("../app/dashboard/Dashboard.tsx", import.meta.url),
    "utf8",
  );

  assert.match(dashboard, /function CompactBarField3D/);
  assert.equal((dashboard.match(/<CompactBarField3D/g) ?? []).length, 1);
  assert.doesNotMatch(dashboard, /function InteractiveBarChart3D/);
  assert.match(dashboard, /frameloop="demand"/);
  assert.match(dashboard, /THREE\.MathUtils\.damp/);
  assert.match(dashboard, /prefersReducedMotion/);
  assert.match(dashboard, /onPointerOver/);
});

test("keeps P&L normal while family ownership remains calmly three-dimensional", async () => {
  const [dashboard, styles] = await Promise.all([
    readFile(new URL("../app/dashboard/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(dashboard, /mode="diverging"/);
  assert.match(dashboard, /className="pnl-row-bars"/);
  assert.match(
    dashboard,
    /className=\{`pnl-bar \$\{item\.unrealizedPnl >= 0 \? "gain" : "loss"\}`\}/,
  );
  assert.match(styles, /\.pnl-track/);
  assert.match(styles, /\.pnl-zero/);
  assert.match(styles, /\.pnl-bar/);
  assert.doesNotMatch(dashboard, /3D bars unavailable/);
  assert.match(dashboard, /className="shared-pool-badge minimal"/);
  assert.match(styles, /\.shared-pool-badge\.minimal/);
});

test("requires Railway PostgreSQL before a market refresh can mutate shared state", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const originalFetch = globalThis.fetch;
  delete process.env.DATABASE_URL;
  globalThis.fetch = async () => {
    throw new Error("Market sources must not run before shared persistence is configured");
  };

  try {
    const response = await requestWorker("/api/market/refresh");
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.match(body.error, /DATABASE_URL|database/i);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});

test("seeds the shared portfolio before the first market refresh persists quotes", async () => {
  const worker = await readFile(
    new URL("../worker/index.ts", import.meta.url),
    "utf8",
  );
  const refreshGuard = worker.match(
    /if \(url\.pathname === "\/api\/market\/refresh" && portfolioRepository\) \{[\s\S]*?\n    \}/,
  )?.[0] ?? "";

  assert.match(
    refreshGuard,
    /await portfolioRepository\.loadOrSeed\(INITIAL_SHARED_PORTFOLIO_STATE\)/,
  );
  assert.ok(
    worker.indexOf("await portfolioRepository.loadOrSeed") <
      worker.indexOf("handleMarketApiRequest("),
  );
});

test("keeps the dashboard public and removes the Edit Mode password gate", async () => {
  const [dashboard, worker] = await Promise.all([
    readFile(new URL("../app/dashboard/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  ]);

  assert.match(dashboard, /const requestEditMode = \(\) => \{\s*setShowScenario\(\(current\) => !current\);/);
  assert.match(dashboard, /const requestImportWorkbook = \(\) => \{\s*fileInputRef\.current\?\.click\(\);/);
  assert.doesNotMatch(dashboard, /edit-password|\/api\/edit-auth|type="password"|EDIT_MODE_PASSWORD/);
  assert.doesNotMatch(worker, /handleEditAuthRequest|EDIT_MODE_PASSWORD|\/api\/edit-auth/);

  const response = await render();
  const html = await response.text();
  assert.match(html, /เปิด Edit Mode/);
  assert.doesNotMatch(html, /edit-password-dialog|type="password"/);
});

test("loads and replaces the latest validated portfolio through shared PostgreSQL", async () => {
  const dashboard = await readFile(
    new URL("../app/dashboard/Dashboard.tsx", import.meta.url),
    "utf8",
  );

  assert.match(dashboard, /fetch\("\/api\/portfolio"/);
  assert.match(dashboard, /fetch\("\/api\/portfolio\/import"/);
  assert.match(dashboard, /parseWorkbookForImport/);
  assert.match(dashboard, /settings: parsed\.settings/);
  assert.match(dashboard, /canonical six-sheet audit workbook/);
  assert.match(dashboard, /requestImportWorkbook/);
  assert.doesNotMatch(dashboard, /Authorize Shared Import|\/api\/edit-auth|type="password"/);
  assert.doesNotMatch(
    dashboard,
    /loadPersistedWorkbook|savePersistedWorkbook|removePersistedWorkbook/,
  );
  assert.doesNotMatch(dashboard, /localStorage|sessionStorage|indexedDB/);
});

test("server-renders the isolated historical Stock Analyzer route", async () => {
  const response = await requestWorker("/analyzer", {
    headers: { accept: "text/html" },
  });
  assert.equal(response.status, 200);

  const [html, analyzerApi, analyzerDashboard, worker] = await Promise.all([
    response.text(),
    readFile(new URL("../app/dashboard/stock-analyzer-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/StockAnalyzerDashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  ]);
  assert.match(html, /Stock Analyzer/i);
  assert.match(analyzerDashboard, /Historical Forward P\/E/i);
  assert.match(analyzerApi, /\/api\/analyzer\/refresh/);
  assert.match(analyzerApi, /TIINGO_API_KEY/);
  assert.match(worker, /handleStockAnalyzerApiRequest/);
  assert.doesNotMatch(html, /TIINGO_API_KEY|FMP_API_KEY/);
});
