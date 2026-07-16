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

async function requestWorkerWithoutEnv(path, init = {}) {
  const worker = await loadWorker();
  return worker.fetch(
    new Request(`http://localhost${path}`, init),
    undefined,
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

test("persists one manual sourced market refresh in shared PostgreSQL", async () => {
  const [dashboard, marketApi, styles] = await Promise.all([
    readFile(new URL("../app/dashboard/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/market-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(dashboard, /Refresh market prices/);
  assert.match(dashboard, /\/api\/market\/refresh/);
  assert.match(dashboard, /createLiveMarketRefreshPlan/);
  assert.match(dashboard, /applyLiveMarketState/);
  assert.match(dashboard, /OpenAI web search/);
  assert.match(dashboard, /saved to shared PostgreSQL/);
  assert.match(marketApi, /reasoning:\s*\{ effort: "none" \}/);
  assert.match(marketApi, /max_output_tokens:\s*300/);
  assert.match(marketApi, /max_tool_calls:\s*2/);
  assert.match(marketApi, /loadRecentMarketRefresh/);
  assert.match(marketApi, /cooldownActive:\s*true/);
  assert.doesNotMatch(marketApi, /previous lookup omitted|retryResponse/);
  assert.match(marketApi, /persistMarketRefresh/);
  assert.match(dashboard, /5-minute API cooldown/);
  assert.doesNotMatch(dashboard, /one manual request for/);
  assert.match(dashboard, /liveMarketState\.sources/);
  assert.doesNotMatch(dashboard, /Google Finance|EODHD/);
  assert.doesNotMatch(dashboard, /setInterval\s*\(/);
  assert.match(styles, /\.live-market-status/);
  assert.match(styles, /\.live-market-source-links/);
  assert.match(styles, /\.button-market-refresh/);

  const response = await render();
  const html = await response.text();
  assert.match(html, /Refresh market prices/);
  assert.match(html, /OpenAI web search/);
  assert.doesNotMatch(html, /Google Finance|EODHD/);
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
  assert.match(styles, /\.ghibli-countryside-ledger\s+\.edit-password-dialog/i);
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

test("keeps the previous compact chart structure while rendering only the bars in 3D", async () => {
  const response = await render();
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /Interactive 3D family ownership bars/i);
  assert.match(html, /Interactive 3D unrealized P&amp;L bars/i);
  assert.match(html, /Interactive 3D net dividend forecast bars/i);
  assert.match(html, /class="ownership-chart"/i);
  assert.match(html, /class="pnl-chart"/i);
  assert.match(html, /class="dividend-owner-chart"/i);
  assert.match(html, /class="compact-r3f-bar-field ownership-r3f-bars"/i);
  assert.match(html, /class="compact-r3f-bar-field pnl-r3f-bars"/i);
  assert.match(html, /class="compact-r3f-bar-field dividend-r3f-bars"/i);
  assert.doesNotMatch(
    html,
    /bar3d-stage|bar3d-controls|bar3d-stage-readout|bar3d-interaction-hint|bar3d-selection/i,
  );
});

test("uses one reusable demand-rendered compact R3F bar-field implementation", async () => {
  const dashboard = await readFile(
    new URL("../app/dashboard/Dashboard.tsx", import.meta.url),
    "utf8",
  );

  assert.match(dashboard, /function CompactBarField3D/);
  assert.equal((dashboard.match(/<CompactBarField3D/g) ?? []).length, 3);
  assert.doesNotMatch(dashboard, /function InteractiveBarChart3D/);
  assert.match(dashboard, /frameloop="demand"/);
  assert.match(dashboard, /THREE\.MathUtils\.damp/);
  assert.match(dashboard, /prefersReducedMotion/);
  assert.match(dashboard, /onPointerOver/);
});

test("keeps P&L depth while family and dividend bars stay straight and calm", async () => {
  const [dashboard, styles] = await Promise.all([
    readFile(new URL("../app/dashboard/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(dashboard, /const isPerformanceMode = mode === "diverging"/);
  assert.match(dashboard, /const liftAmount = isPerformanceMode \? 0\.34 : 0/);
  assert.match(
    dashboard,
    /const groupRotation[^=]*= isPerformanceMode\s*\? \[-0\.13, 0, 0\]\s*:\s*\[0, 0, 0\]/,
  );
  assert.doesNotMatch(dashboard, /3D bars unavailable/);
  assert.match(dashboard, /className="shared-pool-badge minimal"/);
  assert.match(styles, /\.shared-pool-badge\.minimal/);
});

test("verifies the Edit Mode password on the Worker without persisting a session", async () => {
  const env = { EDIT_MODE_PASSWORD: "test-only-password" };
  const wrong = await requestWorker(
    "/api/edit-auth",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "wrong-password" }),
    },
    env,
  );
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers.get("cache-control"), "no-store");
  assert.doesNotMatch(await wrong.text(), /test-only-password|wrong-password/);

  const correct = await requestWorker(
    "/api/edit-auth",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "test-only-password" }),
    },
    env,
  );
  assert.equal(correct.status, 200);
  assert.deepEqual(await correct.json(), { authenticated: true });
  assert.equal(correct.headers.get("set-cookie"), null);

  const unavailable = await requestWorker("/api/edit-auth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "anything" }),
  });
  assert.equal(unavailable.status, 503);

  const unsupported = await requestWorker("/api/edit-auth", {}, env);
  assert.equal(unsupported.status, 405);
});

test("reads the Railway password from Node env when Worker env is absent", async () => {
  const previousPassword = process.env.EDIT_MODE_PASSWORD;
  process.env.EDIT_MODE_PASSWORD = "railway-test-password";
  try {
    const wrong = await requestWorkerWithoutEnv("/api/edit-auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "wrong-password" }),
    });
    assert.equal(wrong.status, 401);

    const correct = await requestWorkerWithoutEnv("/api/edit-auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "railway-test-password" }),
    });
    assert.equal(correct.status, 200);
    assert.deepEqual(await correct.json(), { authenticated: true });
  } finally {
    if (previousPassword === undefined) delete process.env.EDIT_MODE_PASSWORD;
    else process.env.EDIT_MODE_PASSWORD = previousPassword;
  }
});

test("requires Railway PostgreSQL before a Railway OpenAI refresh can mutate shared state", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const originalFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "railway-test-openai-key";
  delete process.env.DATABASE_URL;
  globalThis.fetch = async () => {
    throw new Error("OpenAI must not run before shared persistence is configured");
  };

  try {
    const response = await requestWorkerWithoutEnv("/api/market/refresh");
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.match(body.error, /DATABASE_URL|database/i);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
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

test("keeps the dashboard public but gates every Edit Mode opening with a dialog", async () => {
  const [dashboard, worker] = await Promise.all([
    readFile(new URL("../app/dashboard/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  ]);

  assert.match(dashboard, /fetch\("\/api\/edit-auth"/);
  assert.match(dashboard, /role="dialog"/);
  assert.match(dashboard, /type="password"/);
  assert.match(dashboard, /autoComplete="one-time-code"/);
  assert.match(dashboard, /setEditPasswordPromptVersion/);
  assert.match(dashboard, /key=\{editPasswordPromptVersion\}/);
  assert.match(dashboard, /aria-modal="true"/);
  assert.match(dashboard, /event\.key === "Escape"/);
  assert.match(dashboard, /setShowScenario\(true\)/);
  assert.match(dashboard, /setShowScenario\(false\)/);
  assert.doesNotMatch(dashboard, /localStorage|sessionStorage|EDIT_MODE_PASSWORD/);
  assert.match(worker, /handleEditAuthRequest/);

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
  assert.match(dashboard, /parseMinimalHoldingsWorkbook/);
  assert.match(dashboard, /Authorize Shared Import/);
  assert.doesNotMatch(
    dashboard,
    /loadPersistedWorkbook|savePersistedWorkbook|removePersistedWorkbook/,
  );
  assert.doesNotMatch(dashboard, /localStorage|sessionStorage|indexedDB/);
});
