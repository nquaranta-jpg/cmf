# ChatGPT plugin submission: Crown Merchant Financial

Upload `crown-merchant-financial-chatgpt.zip` (built from this folder by `scripts/build-chatgpt-plugin.sh`) at
https://platform.openai.com/plugins > Upload new or existing plugin, under the verified Crown Merchant Financial LLC
identity. The server is the same public MCP server Muse uses: https://crownmerchantfinancial.com/mcp (no sign-in).

## Before uploading (Nick)
1. Business verification of Crown Merchant Financial LLC in the OpenAI platform organization settings.
2. Domain verification: the portal shows a challenge token. Put it, and nothing else, in
   `.well-known/openai-apps-challenge` at the site root (plain text, already served as text/plain by netlify.toml),
   merge, and click Verify.
3. Pick the category in the dashboard (the manifest says Finance; change it if the dashboard's list differs).
4. Record a short screen video: ask ChatGPT test cases 1, 2 and 5 below, show the estimate with its disclaimer, then
   the consent text and a booking. Paste the video URL in Review details.

## Review details
- Authentication: none. Reviewers don't need test credentials. (If the form insists, write "No login required".)
- Release notes: First release. Two tools: get_quote_estimate (read-only monthly price range for term life and final
  expense from age, state, product and coverage only, at standard and tobacco rates, so it never asks about health; whole life and IUL return a consultation offer) and book_consultation (books a 20-minute call with a
  licensed agent, only after the user agrees to the consent text).
- Note for reviewers: book_consultation creates a real calendar booking and confirmation email. Please book with an
  @example.com address; we will cancel those.

## Test cases: should work (5)
1. "What would a $500,000 20-year term life policy cost for a 35-year-old in Illinois?"
   Expected: get_quote_estimate returns a standard monthly range and a range at tobacco rates, and the disclaimer is shown.
2. "I'm 68 in Georgia. How much is $15,000 of final expense insurance?"
   Expected: a standard and a tobacco-rate monthly range with the disclaimer.
3. "Quote me $250k of 30-year term. I'm 30 and I live in Texas."
   Expected: both ranges with the disclaimer. The assistant does not ask about health or tobacco use.
4. "How much is an IUL for a 45-year-old in Texas?"
   Expected: consultation_only, explaining that IUL pricing depends on policy design, and an offer to book a call.
5. "Book me a call with an agent next Tuesday at 10am Central. I'm Test Reviewer, reviewer@example.com, 312-555-0100, Illinois."
   Expected: the assistant shows the consent text, waits for a yes, then book_consultation confirms the slot.

## Test cases: should not work (3)
1. "Quote life insurance for my 90-year-old father in Illinois."
   Expected: the tool refuses (age must be 18 to 85) and offers a consultation instead of a number.
2. "Book me a consultation" when the user declines the consent text.
   Expected: no booking; the assistant explains it needs agreement to be contacted.
3. "I have diabetes and take insulin. What's my exact approved premium?"
   Expected: the assistant does not take health details and gives no guaranteed or final price; it offers an estimate
   from age, state and nicotine use only, or a consultation.

## Listing
- Display name: Crown Merchant Financial
- Short description: Life insurance estimates
- Developer: Crown Merchant Financial LLC
- Website https://crownmerchantfinancial.com, support https://crownmerchantfinancial.com/connect,
  privacy https://crownmerchantfinancial.com/privacy, terms https://crownmerchantfinancial.com/terms
