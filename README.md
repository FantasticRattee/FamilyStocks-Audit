# Stock Audit Dashboard

Interactive local dashboard for `../Portfolio_Accounting.xlsx`.

It opens with the audited snapshot embedded at build time and can import a newer
workbook through the UI. The original Excel file is never modified.

## Run locally

```bash
npm run dev
```

Open `http://localhost:3001`. Local development is intentionally pinned to this
single port so preview links and browser comments always point to the same app.
The production `npm run start` command does not hardcode a port, so Railway can
continue supplying its own runtime `PORT`.

## Mobile layout

The Family Wealth overview preserves the same dashboard on phones rather than
switching to a reduced mobile version. It is optimized for **390×844** and
remains usable down to **320×568**:

- Header actions remain full-size touch targets; they stack at the narrowest
  width.
- The hero, ownership comparison, allocation ring, P&L, and dividend charts
  stay visible without overlapping their labels or values.
- The family portrait fills the complete hero stage. The allocation ring keeps
  its R3F canvas on WebGL-capable phones and exposes a clickable ring fallback
  when WebGL is unavailable.
- Dashboard tabs scroll horizontally when needed. Data tables retain their
  intentional horizontal scroll wrappers.

The mobile rules are presentation-only: they do not change workbook imports,
Excel exports, market refreshes, password checks, or portfolio calculations.

## Refresh the dashboard data

1. Update and save `Portfolio_Accounting.xlsx` in Excel so formula results are current.
2. Select **Import Excel**, or drag the workbook onto the import area.
3. The source banner will change to **Imported audit snapshot**.

The dashboard reads table labels and headers, not fixed cell addresses. If an
import fails, the currently loaded dashboard stays intact and shows the reason.

### Keep an imported workbook active

After a workbook passes validation, the dashboard saves one raw workbook copy in
**IndexedDB** for that browser profile. Reloading the page or returning later in
the same browser restores that imported source automatically. A later valid
import replaces it; a rejected import cannot replace the last known-good copy.

Only the source workbook bytes, filename, schema version, and save time are
stored. Live market quotes, unsaved Edit Mode changes, the Edit Mode password,
and API keys are never written to browser storage. Import the workbook again on
a different browser or device. The web UI presents the shareholder aliases as
**Mom**, **Rattee**, and **Ryu** without changing the labels in Excel.

## Refresh market prices

Select **Refresh market prices** in the top bar for one manual, display-only
refresh. There is no automatic timer and the Excel workbook remains the audit
record.

- The Worker first makes **one OpenAI Responses API web-search request** for
  GOOGL, USD/THB, SCB, and KBANK. If any quote is missing, it makes at most one
  focused retry for only the missing keys. The prompt accepts an active
  intraday quote while a market is open and the latest official close after it
  closes. The UI labels returned values **OpenAI web search · searched live**
  and shows clickable *Sources consulted* links returned by the search.
- OpenAI is the only provider for this button. If its key, search sources, or
  quote data are unavailable, the dashboard keeps the imported Excel audit
  prices and FX instead of trying another provider.

The response updates dashboard market value and unrealized P&L only. It never
changes transactions, cost basis, audit scenario values, or the workbook that
would be exported. A provider-specific status line shows the source and
freshness. Any missing, invalid, currency-mismatched, or uncited result
continues to use the imported Excel audit price (and imported FX if USD/THB
cannot refresh).

### Configure OpenAI web search

1. Create a new OpenAI API key in the Platform dashboard. Do **not** paste it
   into chat or commit it to source control.
2. In the ignored local `.dev.vars`, add
   `OPENAI_API_KEY=<your-new-key>`. Optionally set
   `OPENAI_MARKET_MODEL=gpt-5.6`; this is the default when omitted.
3. Restart `npm run dev`, then select **Refresh market prices**.

Each click uses one API request when all four values are found, or two requests
when a focused missing-key retry is needed. Both require live web search and
therefore incur OpenAI API usage. This is a sourced lookup, not a licensed
exchange feed: inspect the displayed sources before acting on a value, and keep
the workbook's entered price/cost basis as the historical audit record.

For Cloudflare deployment, set `OPENAI_API_KEY` (and optionally
`OPENAI_MARKET_MODEL`) as Worker secrets rather than browser-visible variables.
For Railway, use the service Variables described below. The key is used only
in `worker/index.ts` → `market-api.ts` and is never sent to the browser.

## Edit and export Excel

**Edit Mode** lets you change an active holding's audit ticker and current
price, then download a new audited workbook. It also retains the existing
scenario controls for USD/THB FX, DPS, and withholding-tax rate.

Edit Mode is password-gated while the rest of the dashboard remains public.
The password is checked by the Worker and is not stored in browser storage or a
cookie. Closing Edit Mode relocks it, so every new opening asks for the password
again. Local development reads `EDIT_MODE_PASSWORD` from the ignored
`.dev.vars` file; use `.dev.vars.example` as the configuration template. Before
deploying, configure `EDIT_MODE_PASSWORD` as a secret in the Worker environment.

## Deploy on Railway

Use `npm run build` as the build command and `npm run start` as the start
command. In the Railway service's **Variables** page, add:

```text
EDIT_MODE_PASSWORD=<your-production-password>
OPENAI_API_KEY=<your-openai-api-key>
OPENAI_MARKET_MODEL=gpt-5.6
```

`OPENAI_MARKET_MODEL` is optional. Deploy or redeploy after changing a
variable; the currently running deployment cannot see a newly saved value
until the replacement deployment starts.

No database is required for the current design. Password verification is a
stateless server check, and the latest validated imported workbook remains in
that browser profile's IndexedDB. A database would only be needed later for
user accounts, server sessions, or a workbook shared across devices.

The server adapter reads only the three allow-listed names above. It prefers a
Cloudflare Worker binding when present and otherwise reads Railway's Node
runtime environment. Secrets are never embedded in browser JavaScript or
committed `.dev.vars` files.

1. Enter a company name or ticker in **Search Yahoo**, choose the correct
   result, then fetch its current price. A search result is never selected
   automatically.
2. Yahoo is best-effort: if it is unavailable or rate-limits the request, enter
   a **Manual** price instead.
3. Select **Save & Download Excel**. The dashboard downloads a timestamped
   `Portfolio_Accounting_edited_*.xlsx`; it never overwrites the source file.

Changing the audit ticker is deliberately a **global ticker migration** in the
downloaded copy. It updates exact ticker values and formula criteria across the
historical ledger, while preserving dates, trade prices, quantities, cost basis,
ownership, and classifications. Each export adds a visible **Dashboard Audit**
sheet showing ticker mappings, price source, quote currency, FX, and timestamps.

Yahoo remains an Edit Mode-only search/manual-price source. The public
**Refresh market prices** button uses OpenAI web search only; without its
Worker key, the dashboard retains the imported audit values.

Prices for USD holdings are converted to THB using the Edit Mode FX input before
being written to `Holdings`. DPS and withholding-tax edits are included in the
downloaded copy as well. When the workbook has a current-capital forecast block,
DPS edits target that block and leave past dividend records unchanged. Use
**Reset** to discard unsaved dashboard edits.

## Audit rules preserved

- Shared pool = **SCB + KBANK only**.
- Personal positions never change the SCB/KBANK shared-pool dividend forecast.
- The April 2026 dividend is historical. The next-cycle forecast uses current
  shared capital × the blended recurring dividend yield from current SCB/KBANK
  holdings, so it changes when the imported capital changes.
- If more than one account holds the same ticker, Edit Mode shows one global
  ticker/price control and writes the result to every matching active row.
- Realized P&L is displayed from the imported workbook and should receive
  lot-time-specific review before any settlement use.

## Verify

```bash
npm run lint
npm test
npx tsx --test tests/dashboard-model.test.ts tests/workbook-editing.test.ts tests/edit-model.test.ts tests/market-api.test.ts tests/live-market.test.ts
```

The app is a Vite/Vinext project with a Cloudflare Worker-compatible build. Run
`npm run build` before deploying with your preferred deployment workflow.
