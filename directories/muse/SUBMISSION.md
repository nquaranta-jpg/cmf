# Muse Platform Submission: Crown Merchant Financial

Paste-ready values for https://muse.ai/platform. Log in with the CMF work email
(nquaranta@crownmerchantfinancial.com), pick connection type **Existing MCP**.

Pre-flight before you open the form:

- [ ] `https://crownmerchantfinancial.com/mcp/health` returns `{"ok":true,...}`
- [ ] MCP Inspector against `https://crownmerchantfinancial.com/mcp` lists both tools
- [ ] `RATES_VERIFIED=true` set in Netlify only if rates.json is fully filled (else quotes answer consultation_only, which is still acceptable for submission)
- [ ] `BOOKER_URL` and `BOOKER_SECRET` set in Netlify, Apps Script `testBooked()` passed
- [ ] states.json lists all 50 states + DC; remove any state where a license has lapsed
- [ ] Compliance reviewed section 6 of the build spec

## Form values

| Field | Value | Length |
|---|---|---|
| Name | `Crown Merchant Financial` | 24 |
| Tagline | `Life insurance estimates and a licensed agent on your calendar` | 61 |
| Short description | `Get an estimated life insurance premium and book a free video call with a licensed independent agent.` | 102 |
| Category | Finance (or Insurance if that exists) | |
| Connection type | Existing MCP | |
| Endpoint URL | `https://crownmerchantfinancial.com/mcp` | |
| Transport | Streamable HTTP (stateless, JSON responses) | |
| Auth | None (see "Auth stop order" below) | |
| Icon | `directories/muse/icon-512.png` (512x512 PNG, crown mark on navy) | |
| Docs URL | `https://crownmerchantfinancial.com/connect/muse` | |
| Privacy policy URL | `https://crownmerchantfinancial.com/privacy` | |
| Terms URL | `https://crownmerchantfinancial.com/terms` | |
| Support email | `nquaranta@crownmerchantfinancial.com` | |
| Support phone | `(312) 203-8106` | |
| Company | Crown Merchant Financial LLC, 5113 S Harper Ave, Suite 2C, Chicago, IL 60615 | |

### Long description

Crown Merchant Financial is a licensed independent life insurance agency based in Chicago. This connector gives your assistant two tools: an instant monthly premium estimate for term life and final expense coverage, and a booking tool that puts a free 20-minute Google Meet consultation with a licensed agent on the calendar. Estimates are ranges, not offers of coverage, and every result carries a plain disclaimer. We collect only what scheduling needs: name, email, phone, state, and the coverage details you already discussed. No health history, no Social Security number, no payment information. Available in the states where we hold a license.

(5 sentences, 640 characters.)

## Tools

| Tool | Reads | Writes | Data collected |
|---|---|---|---|
| `get_quote_estimate` | yes | no | age, state, tobacco yes/no, product type, coverage amount, term length |
| `book_consultation` | no | yes (calendar event, email, lead row) | first and last name, email, phone, state, preferred time, consent flag, optional product interest, quote context, budget, decision-maker flag |

## Test prompts for Meta's end-to-end review

| # | Prompt | Expected behavior |
|---|---|---|
| 1 | How much would a $500k 20-year term policy cost for a 35-year-old non-smoker in Illinois? | `get_quote_estimate` returns `estimate` with a monthly range, the disclaimer is shown, assistant offers to book a call. If rates are not yet verified, returns `consultation_only` and offers the call. |
| 2 | Get me a life insurance quote, I'm 62 and live in Georgia, I want $15,000 for final expenses. | Final expense estimate (or `consultation_only` if rates not verified), disclaimer shown, offer to book. |
| 3 | I want an IUL. | Assistant asks for age and state if missing, tool returns `consultation_only` with the "depends on how the policy is designed" message and offers booking. |
| 4 | I'm 72, quote me 20-year term in Texas. | `consultation_only`: automated term estimates cover ages 18 to 70, offers booking. |
| 5 | Book me a call with Crown Merchant Financial Tuesday at 2pm Central. | Assistant shows the consent text and asks for a yes, collects name/email/phone/state, calls `book_consultation`. Result is `booked` with a Meet link, or `slot_unavailable` with three alternate ISO times, or `invalid_time` with a reason. |

## Attestations

The owner (Nick) checks the three attestations personally on the form. Do not
delegate this step.

## Auth stop order

v1 has no user accounts, so the server is no-auth. If the form will not accept a
no-auth MCP connector:

1. STOP. Do not build an OAuth server on spec.
2. Copy the exact wording of what the form requires (fields, auth types offered,
   any "required" markers) into the block below and bring it back to Nick.

```
Form auth requirement observed on YYYY-MM-DD:

```

## After approval

- Zero booked calls from Muse 60 days after approval: leave it running, stop touching it.
- Rejection: read the reason, one fix pass under two hours, resubmit once. Second rejection means shelve.
