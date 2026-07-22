# CMF Email Campaigns

Send recurring email campaigns (500+ at a time) to existing clients/contacts via [Brevo](https://www.brevo.com). Brevo handles deliverability, automatic unsubscribe management, and CAN-SPAM compliance, and gives you open/click stats per campaign.

## One-time setup

1. Create a Brevo account at [brevo.com](https://www.brevo.com) (free tier: 300 emails/day — enough to test; the Starter plan removes the daily cap so you can send 500+ in one blast).
2. Verify your sender: **Settings > Senders, Domains & Dedicated IPs**. Verify the CMF domain (add the SPF/DKIM DNS records Brevo shows you) — sending from a verified domain, not a free Gmail address, is what keeps you out of spam folders.
3. Get an API key: profile menu > **SMTP & API > API Keys > Generate a new API key**.
4. Configure:
   ```bash
   cd email-campaigns
   cp .env.example .env
   # then edit .env with your API key and verified sender email
   ```

Requires Node 18+. No npm install needed.

## Sending a campaign

**1. Import your contacts** (CSV with `first_name`, `last_name`, `email` columns — see `contacts.sample.csv`):

```bash
node import-contacts.js my-clients.csv --list "CMF Clients"
```

Re-running is safe: existing contacts are updated, not duplicated. Anyone who unsubscribed stays unsubscribed.

**2. Send yourself a test first:**

```bash
node send-campaign.js --subject "July Client Update" --test nquaranta17@gmail.com
```

**3. Send (or schedule) the real thing:**

```bash
node send-campaign.js --subject "July Client Update" --send-now
```

```bash
node send-campaign.js --subject "July Client Update" --schedule "2026-07-25T09:00:00-04:00"
```

Run without `--send-now`/`--schedule` to create a draft you can preview and send from the Brevo dashboard instead.

## Editing the email

Edit `templates/newsletter.html` (or copy it per campaign and pass `--template path/to/file.html`). Personalization tags:

- `{{ contact.FIRSTNAME | default : "there" }}` — recipient's first name
- `{{ unsubscribe }}` — required unsubscribe link (Brevo fills it in; leave it in the footer)

## Notes

- **Only email people with an existing relationship or opt-in.** Blasting purchased/aged lead lists through Brevo will get the account suspended and can violate CAN-SPAM.
- Track results (opens, clicks, bounces, unsubscribes) at app.brevo.com > Campaigns.
- Never commit `.env` — it's gitignored.
