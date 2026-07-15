# Stock Audit Dashboard

Interactive local dashboard for `../Portfolio_Accounting.xlsx`.

It opens with the audited snapshot embedded at build time and can import a newer
workbook through the UI. The original Excel file is never modified.

## Run locally

```bash
npm run dev
```

Open the Local URL printed by the command (normally `http://localhost:3000`).

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

- When `OPENAI_API_KEY` is configured, the Worker makes **one OpenAI Responses
  API web-search request** for GOOGL, USD/THB, SCB, and KBANK. The UI labels
  these values **OpenAI web search · searched live** and shows clickable
  *Sources consulted* links returned by the search.
- Without that key, the existing free hybrid fallback remains available: GOOGL
  and USD/THB come from a Google Finance Sheets/Apps Script bridge (possibly
  delayed), while SCB and KBANK come from EODHD's latest EOD close.

The response updates dashboard market value and unrealized P&L only. It never
changes transactions, cost basis, audit scenario values, or the workbook that
would be exported. A provider-specific status line shows the source and
freshness. Any missing, invalid, currency-mismatched, or uncited result
continues to use the imported Excel audit price (and imported FX if USD/THB
cannot refresh).

### Configure OpenAI web search (primary)

1. Create a new OpenAI API key in the Platform dashboard. Do **not** paste it
   into chat or commit it to source control.
2. In the ignored local `.dev.vars`, add
   `OPENAI_API_KEY=<your-new-key>`. Optionally set
   `OPENAI_MARKET_MODEL=gpt-5.6`; this is the default when omitted.
3. Restart `npm run dev`, then select **Refresh market prices**.

Each click is one API request with required live web search, so it incurs your
OpenAI API usage. It is a sourced lookup, not a licensed exchange feed: inspect
the displayed sources before acting on a value, and keep the workbook's entered
price/cost basis as the historical audit record.

For Cloudflare deployment, set `OPENAI_API_KEY` (and optionally
`OPENAI_MARKET_MODEL`) as Worker secrets rather than browser-visible variables.
The key is used only in `worker/index.ts` → `market-api.ts` and is never sent to
the browser.

### Optional free hybrid fallback

1. Create a free EODHD account and copy its API token.
2. Copy .dev.vars.example to the ignored .dev.vars file and add
   EODHD_API_TOKEN=<your token>.
3. Create a Google Sheet with a tab named Market. Add this table:

| Key | Price | Currency | Quote timestamp |
|---|---|---|---|
| GOOGL | =GOOGLEFINANCE("NASDAQ:GOOGL","price") | USD | =GOOGLEFINANCE("NASDAQ:GOOGL","tradetime") |
| USDTHB | =GOOGLEFINANCE("CURRENCY:USDTHB") | THB | =NOW() |

4. Open **Extensions → Apps Script**, replace the default file with
   dashboard/scripts/google-finance-bridge/Code.gs, then deploy it as a **Web
   app**. Set **Execute as** to your account and allow access for anyone who has
   the link. The sheet contains public market values only.
5. Copy the deployed URL ending in /exec into
   GOOGLE_FINANCE_BRIDGE_URL in .dev.vars.

This fallback activates only when `OPENAI_API_KEY` is absent. For Cloudflare
deployment, set `EODHD_API_TOKEN` and `GOOGLE_FINANCE_BRIDGE_URL` as Worker
secrets rather than browser-visible variables. EODHD's free tier allows 20 API
calls/day; SCB and KBANK use two calls per refresh, so roughly ten uncached
refreshes are available daily. The dashboard sends these requests only from the
Worker; the EODHD token is never sent to the browser.

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
**Refresh market prices** button uses OpenAI web search when its Worker key is
configured, otherwise the Google Finance plus EODHD fallback.

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
