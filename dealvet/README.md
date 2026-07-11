# DealVet

A multifamily deal-screening tool for a small syndication group. Paste a listing URL (or enter the numbers by hand), walk through a structured six-stage underwriting algorithm, and get a **PASS / CONDITIONAL / FAIL** verdict with a scorecard and a suggested offer ceiling.

## Quick start

```bash
npm install
npm run dev
```

That starts both the Express API (port 3001) and the Vite dev server — open **http://localhost:5173**.

```bash
npm test   # unit tests for the underwriting math
```

## Design principles

- **Listing data is never trusted.** Anything scraped from a URL is marked *unverified* and must be confirmed field-by-field before it feeds the math. Listed "gross income" is displayed for reference only — income is always rebuilt from per-unit rents.
- **No hidden constants.** Every assumption (vacancy, expense ratios, loan terms, threshold bands) is shown with its default and is editable in the UI.
- **Market rent stays your call, with a data anchor.** The Income step includes a HUD Fair Market Rent lookup (bundled dataset, no API key): it auto-finds the property's FMR area from the address and can pre-fill per-bedroom rents as a starting point. FMRs run near the 40th percentile of area rents, so treat them as an anchor/floor — your own comps have the final word. To refresh the data each fiscal year, download the latest `FY*_FMRs*.xlsx` from [huduser.gov](https://www.huduser.gov/portal/datasets/fmr.html) and run `node scripts/build-fmr-data.mjs <file> FY20XX`.
- The math lives in one pure, tested module: [`src/lib/underwriting.ts`](src/lib/underwriting.ts).

## The algorithm

### Stage 1 — Income sanity check
- **GRM** = price ÷ annual gross rent (from unit rents)
- **Gross yield** = annual gross rent ÷ price
- **Rent upside %** = (market rent − current rent) ÷ current rent
- Upside < **5%** → "limited value-add — the deal must work on price alone." Upside ≥ **15%** → tagged a value-add candidate.

### Stage 2 — The real operating statement
```
Gross Scheduled Rent  = Σ monthly unit rents × 12
− Vacancy loss        = GSR × vacancy %            (default 6%)
= Effective Gross Income
− Taxes (actual) − Insurance − Water/Sewer
− Maintenance (10% EGI) − Management (9% EGI)
− CapEx reserve ($300/unit/yr)
= NOI
```

### Stage 3 — Cap rate
Cap = NOI ÷ price. Default band (editable): **good ≥ 6.5%**, marginal 5–6.5%, **poor < 5%**.

### Stage 4 — Debt & DSCR
- Loan = price × (1 − down payment %), default 25% down, 6.5%, 30-yr amortization
- Annual debt service from the standard amortizing payment formula
- **DSCR = NOI ÷ annual debt service** — fail < **1.20**, conditional 1.20–1.25, pass ≥ **1.25**
- Cash flow before investors = NOI − debt service (negative ⇒ automatic fail)

### Stage 5 — Due-diligence checklist
Human gates, not math: legal use, lead paint (auto-flagged if built < 1978), knob-and-tube/oil tank (auto-flagged if built < 1940), actual leases, trailing-12 actuals, inspection, insurance quote, lender term sheet. Warnings are auto-generated from the property data (e.g. owner-paid hot-water/baseboard heat ⇒ "$4–6k/yr swing").

### Stage 6 — Verdict
- **FAIL** — DSCR < 1.20, OR negative cash flow, OR cap rate below the poor threshold.
- **CONDITIONAL** — marginal metrics; OR hard-fail metrics *but* rent upside ≥ 15% ("only works as a value-add — verify rents, negotiate price"); OR metrics pass but the checklist is incomplete.
- **PASS** — cap rate, DSCR, and cash flow all clear their thresholds and the checklist is acknowledged.

**Solve for price:** because NOI doesn't depend on price (taxes are entered as actuals), the max price is closed-form for both constraints — `NOI ÷ (targetDSCR × (1−dp) × annual payment factor)` and `NOI ÷ targetCap`. The offer ceiling is the lower of the two. *Caveat: taxes may be reassessed after sale; re-run with projected taxes if your jurisdiction reassesses on transfer.*

## Deploying (Render / Railway / Fly)

The app ships as a single Docker container: Express serves both the API and the built frontend, with headless Chrome inside for scraping and PDFs. `PORT` and `DATA_DIR` are env-configurable.

**Render (free tier):**
1. Push this folder to GitHub (it can live as a subdirectory of a larger repo).
2. Render dashboard → New → Web Service → connect the repo → set **Root Directory** to `dealvet` (if it's a subdirectory) → Runtime auto-detects the Dockerfile → plan Free → deploy. (Or move `render.yaml` to the repo root for a one-click blueprint.)
3. That's it — the service URL serves the whole app.

**Free-tier caveats:**
- Instances sleep when idle; the first request after a while takes ~30–60s to wake.
- The disk is ephemeral — `data/analyses.json` resets on redeploys. The client compensates: every save is mirrored to the browser's localStorage and silently re-uploaded if the server has lost it, so *your* browser never loses analyses. For durable multi-device storage, attach a persistent disk (Render paid) and point `DATA_DIR` at it.
- The deploy is public: anyone with the URL can view and create analyses.

Local prod simulation: `npm run build && npm start` (serves everything on :3001), or `docker build -t dealvet . && docker run -p 3001:3001 dealvet`.

## Structure

```
server/          Express API — /api/scrape (best-effort extractor), /api/analyses (JSON-file store in data/)
src/lib/         underwriting.ts (pure math + verdict), underwriting.test.ts, format.ts
src/components/  InputScreen, PropertyForm (unverified-field confirmation), stages/ (one screen per stage)
```

## Exporting

The Verdict screen has an **Export & publish** card:

- **Download PDF report** — the server renders a print-styled underwriting report (headless Chrome) and streams back a `.pdf`: property summary, operating statement, debt test, verdict with reasons, offer ceiling, and due-diligence flags.
- **Copy Substack article** — builds a narrative article from the analysis and copies it as rich text; paste straight into a Substack post (headings and tables carry over). Substack has no public posting API, so paste-and-publish is the workflow. Always review for voice before publishing.
- **Download .md** — the same article as Markdown.

The article builders live in [`src/lib/report.ts`](src/lib/report.ts) (pure + tested) and every export ends with a not-investment-advice disclaimer.

## Scraping

The extractor is generic, never provider-specific, and runs in two passes:

1. **Plain fetch + cheerio** — JSON-LD, meta tags, loose text patterns. Fast; enough for server-rendered pages.
2. **Headless Chrome (puppeteer)** — if pass 1 comes back thin (JS-rendered pages like MLS collab links), the page is rendered in a real browser and the rendered text is parsed, including MLS-style label/value pairs (`Tax Annual Amount`, `Year Built`, `Unit 1 Rental Amount`, `Heating`, …). It polls while the SPA hydrates and will click into the first listing card if it landed on a search-results page. Expect this pass to take ~10–20 seconds.

Unit rents, beds, and baths are extracted when present, so a good listing pre-fills the entire form. Everything scraped is still marked **unverified** and must be confirmed field-by-field. Manual entry remains the fallback of last resort.

Note: `npm install` downloads a private copy of Chrome (~150 MB) for puppeteer the first time.
