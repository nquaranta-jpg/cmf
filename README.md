# Crown Merchant Financial — crownmerchantfinancial.com

Static site on Netlify (publish = repo root, no build step) with Netlify
Functions for lead capture, plus **CMF Launch**, the agent-facing growth
platform under `/launch`.

## Structure

```
index.html, quote.html, products/…     consumer site (final expense, term, IUL, annuity)
launch/                                CMF Launch marketing pages + client platform
css/, js/                              shared plain CSS/JS (variables.css = brand tokens)
netlify/functions/                     backend (Supabase via service role)
supabase/                              SQL to create/seed the CMF Launch tables
dashboard/                             internal agent dashboard (PIN-gated)
```

Local dev: `npx netlify dev` (pulls env vars from the linked Netlify site).

## Merchants (payments desk + statement analyzer)

Routes: `/merchants` (marketing page + upload form), `/merchants/review`
(internal, password-gated, noindex), `/merchants/onepager?id=...` (printable
analysis, opened from the review page).

Flow: prospect uploads a processing statement (PDF or phone photos; images
are compressed client-side) → `merchant-analyzer.mjs` stores the lead +
files in Netlify Blobs (store `merchant-statements`) and notifies
Telegram/email → `merchant-analyzer-background.mjs` runs a Claude
(`claude-sonnet-4-6`) extraction with a conservative prompt and recomputes
the fair-pricing math server-side (interchange + 0.30% + $0.10/txn) →
result waits in the review queue. **Nothing is ever sent to the prospect
automatically**; approve on the review page, then deliver the one-pager
manually by email. Low-confidence or failed extractions land as
`needs_manual` with the lead intact.

Env vars: `ANTHROPIC_API_KEY` (required), `MERCHANTS_REVIEW_PASSWORD`
(required for the review page), `BREVO_API_KEY` + `MERCHANTS_NOTIFY_EMAIL`
(+ optional `MERCHANTS_NOTIFY_FROM`) for email notifications — see
`.env.example`. The one-pager's scheduling link is the `SCHEDULING_URL`
constant at the top of the script in `merchants/onepager.html`.

## CMF Launch

Routes: `/launch` (funnel), `/launch/leads`, `/launch/ads`, `/launch/training`,
`/launch/match`, `/launch/login`, `/launch/app` (client dashboard).

Backend functions:

- `launch-forms.mjs` — all public forms (IUL opt-in, lead inquiry, ads
  application, training consult, Match application) → `launch_submissions`
  table + Telegram notification. Spam protection: honeypot, time-trap,
  disposable-email blocklist, per-IP rate limit, Turnstile (when
  `TURNSTILE_SECRET_KEY` is set).
- `launch-api.mjs` — login (email/password, scrypt hashes, HMAC session
  tokens), dashboard data, lead status updates, CSV export.
- `launch-meta-webhook.mjs` — Meta Lead Ads webhook (stub; see below).

### Setup (one time)

1. In the Supabase SQL editor (same project the consumer `lead.mjs` uses),
   run `supabase/launch_schema.sql`, then `supabase/launch_seed.sql`.
2. That's it — `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` are already set in
   Netlify for the consumer functions.

### Demo mode & demo login

Sign in at `/launch/login` with **demo@cmflaunch.com / LaunchClient2026!**.

- Before the SQL is run, `launch-api.mjs` serves a built-in sample dataset
  (banner shows "Demo mode"); status/note edits don't persist.
- After the seed runs, the same login hits the real seeded rows.
- **Production:** set `LAUNCH_DEMO=false` in Netlify to disable the built-in
  fallback, and delete/deactivate the demo row in `launch_clients`.

### Creating client accounts

No self-signup. Insert a row into `launch_clients`; generate the password hash with:

```bash
node -e "const c=require('crypto');const s=c.randomBytes(16).toString('hex');console.log('scrypt\$16384\$'+s+'\$'+c.scryptSync(process.argv[1],s,64).toString('hex'))" 'TheirPassword'
```

Set `plan` (`leads_starter|leads_pro|leads_elite|ads_managed|training`) and
`monthly_ad_budget` for ads clients. Assign leads by setting
`launch_leads.client_id`; log spend in `launch_spend_entries` (one row per
client per day).

### Exports

CSV of submissions or leads (uses the internal dashboard's `DASHBOARD_PIN`):

```
/.netlify/functions/launch-api?action=export&type=submissions&pin=<DASHBOARD_PIN>
/.netlify/functions/launch-api?action=export&type=leads&pin=<DASHBOARD_PIN>
```

### Plug in real pricing

- `launch/leads.html` — tier cards show `$XXX` placeholders; replace prices
  and bullet lists in the three `.tier-card` blocks, and delete the
  "placeholder pricing" notes.
- `launch/index.html` — FAQ answer under "What do the tiers cost?".

### Plug in payment links

No payments are wired yet (`billing_status` is a placeholder). When ready
(e.g. Stripe Payment Links): point the tier-card "Inquire" buttons on
`launch/leads.html` at your payment links, and swap the ads/training form
success messages to link checkout. Update `launch_clients.billing_status`
from your payment provider's webhooks.

### Plug in Meta Lead Ads webhook credentials

Set in Netlify env vars:

- `META_VERIFY_TOKEN` — any random string; used for the subscription handshake
- `META_APP_SECRET` — from your Meta app (enables signature verification)
- `META_PAGE_ACCESS_TOKEN` — page token with `leads_retrieval`

Then subscribe the page to the `leadgen` field with callback URL
`https://crownmerchantfinancial.com/.netlify/functions/launch-meta-webhook`,
and finish the two `TODO(meta)` items in `launch-meta-webhook.mjs`
(page→client mapping and lead-type mapping). Raw webhook events are already
archived in `launch_submissions` so nothing is lost meanwhile.

### Env vars (all in Netlify)

| Var | Status | Purpose |
| --- | --- | --- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | existing | all DB access |
| `DASHBOARD_PIN` | existing | internal dashboard + Launch CSV exports |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_GROUP_CHAT_ID` | existing | form notifications |
| `TURNSTILE_SECRET_KEY` | optional | bot challenge on forms |
| `LAUNCH_SESSION_SECRET` | optional | dedicated HMAC key for Launch sessions (falls back to `SUPABASE_SERVICE_KEY`) |
| `LAUNCH_DEMO` | optional | set `false` in production to kill the demo fallback |
| `META_VERIFY_TOKEN`, `META_APP_SECRET`, `META_PAGE_ACCESS_TOKEN` | todo | Meta Lead Ads webhook |
