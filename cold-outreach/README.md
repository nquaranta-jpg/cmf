# CMF Realtor Outreach

Throttled cold-email tool for building realtor referral relationships (mortgage protection for their past clients). Sends a 3-touch plain-text sequence at a safe daily pace, tracks every contact's state, and stops the moment someone replies or opts out.

**Why not one 500-email blast?** Because Gmail/Outlook flag exactly that pattern, and you'd burn the domain. This sends 10–40/day with human-like pacing (45–120s between emails). 500 realtors ≈ 2–4 weeks of sending — and far more of them actually see it.

## One-time setup (do this before anything else)

1. **Buy a secondary domain** for outreach (e.g. `cmf-partners.com`). Never send cold email from your main domain or personal Gmail — if the outreach domain gets a bad reputation, your real email is unaffected.
2. **Set up an inbox on it** — Google Workspace (~$7/mo) is the easy option. Add SPF, DKIM, and DMARC DNS records (Workspace walks you through it). All three are mandatory for cold email in 2026.
3. **Warm it up for ~2 weeks**: send a handful of normal emails daily to people who'll reply (yourself, colleagues), subscribe to a few newsletters, reply to things. A brand-new silent inbox that suddenly sends 30 emails/day gets flagged.
4. Create an **App Password** (Google Account > Security > 2-Step Verification > App passwords) for SMTP.
5. Configure:
   ```bash
   cd cold-outreach
   cp .env.example .env
   # fill in SMTP creds, your name/phone, and a real postal address (CAN-SPAM requires it)
   ```

## Daily workflow

1. Put your realtor list in `realtors.csv` (columns: `first_name,last_name,email,brokerage,city` — see the sample). Only include addresses you gathered legitimately (public brokerage sites, networking, license rolls — not scraped/purchased bulk dumps).
2. Preview what today's run would do:
   ```bash
   node send.js --dry-run
   ```
3. Send today's batch:
   ```bash
   node send.js
   ```
   Safe to re-run — it never exceeds `DAILY_LIMIT` per calendar day. Follow-ups (touch 2 after 4 days, touch 3 after 5 more) go out automatically before new contacts.
4. **Check the inbox and mark replies** — otherwise people who answered keep getting follow-ups:
   ```bash
   node mark.js replied sarah@example-realty.com
   node mark.js unsubscribed mlee@example-homes.com
   ```
   Honor every "unsubscribe" reply immediately — it's the law, not a courtesy.

To automate the daily run, add a cron entry (weekdays at 9:30am):
```bash
crontab -e
# 30 9 * * 1-5 cd "/Users/nicholasquaranta/Desktop/Code Projects/cmf/cold-outreach" && /usr/local/bin/node send.js >> send.log 2>&1
```

## Ramp schedule

| Week | DAILY_LIMIT |
|------|-------------|
| 1    | 10          |
| 2    | 20          |
| 3+   | 30–40       |

If you see bounces spike or replies drop to zero, stop and check: test-send to a Gmail you own and see if it lands in spam.

## Editing the sequence

Emails live in `sequence/` — plain text on purpose (cold emails with HTML/images/links get filtered harder and answered less). First line is `Subject: ...`, then a blank line, then the body. Placeholders like `{{first_name|there}}` pull from the CSV columns (`{{from_name}}`, `{{phone}}`, `{{postal_address}}` come from `.env`); the part after `|` is the fallback.

Every email must keep: your real name, the postal address, and the unsubscribe line. Those are CAN-SPAM requirements.

## Running on Netlify (no laptop needed)

The scheduled function [outreach-send.mjs](../netlify/functions/outreach-send.mjs) runs the same sequence from Netlify's servers: every 10 minutes on weekdays (≈9am–6pm ET) it sends **one** email — same pacing, fully hands-off. Contacts, templates, and progress live in Netlify Blobs.

Setup:

1. Set the env vars on the site (Site configuration > Environment variables, or CLI):
   ```bash
   netlify env:set SMTP_HOST smtp.gmail.com && netlify env:set SMTP_PORT 587
   netlify env:set SMTP_USER you@your-outreach-domain.com
   netlify env:set SMTP_PASS "your-app-password"
   netlify env:set FROM_EMAIL you@your-outreach-domain.com
   netlify env:set FROM_NAME "Nick Quaranta"
   netlify env:set PHONE "(555) 555-5555"
   netlify env:set POSTAL_ADDRESS "123 Main St, Tampa, FL 33601"
   netlify env:set DAILY_LIMIT 10
   ```
2. Add `NETLIFY_AUTH_TOKEN` to `cold-outreach/.env`, then upload your list and templates:
   ```bash
   node netlify-sync.js push
   ```
3. Flip the kill switch on (it's off by default — the function does nothing until this is `true`):
   ```bash
   netlify env:set OUTREACH_ENABLED true
   ```

Day to day:

```bash
node netlify-sync.js status                      # progress: sent, active, replied, errors
node netlify-sync.js mark replied sarah@x.com    # STILL REQUIRED daily — stops their follow-ups
node netlify-sync.js push                        # re-upload after editing the list or templates
netlify env:set OUTREACH_ENABLED false           # pause everything instantly
```

The one thing Netlify can't do for you: **read the inbox**. Check it daily and `mark` replies/unsubscribes, or people who answered keep getting the sequence.

The schedule is UTC (`*/10 13-21 * * 1-5` in the function). During EST (winter), shift it to `14-22` if you care about exact business hours.

## Files

- `send.js` — the daily sender
- `mark.js` — record replies/unsubscribes
- `sequence/` — the 3-touch email copy
- `state.json` — per-contact progress (auto-created; gitignored)
- `realtors.csv` — your list (gitignored — don't commit prospect data)
