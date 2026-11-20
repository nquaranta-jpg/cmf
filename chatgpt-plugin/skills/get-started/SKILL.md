---
name: get-started
description: Get a life insurance price estimate from Crown Merchant Financial and, if the person wants exact pricing or to apply, book a free consultation with a licensed agent.
---

# Crown Merchant Financial: life insurance estimates

Use this when someone asks what life insurance would cost, compares term or final expense coverage, or wants to talk to a licensed agent.

1. Ask only for what the estimate needs: age, the two-letter state they live in, whether they used nicotine or tobacco in the last 12 months, the product (term, final expense, whole life or IUL), the coverage amount, and for term the length (10, 20 or 30 years). Never ask about health history, medications, date of birth, Social Security number or payment details.
2. Call `get_quote_estimate`. Show the monthly range and always show the disclaimer it returns. Whole life and IUL return a consultation offer instead of a number; say so plainly.
3. If they want exact pricing or to apply, offer a free 20-minute consultation. Before calling `book_consultation`, show the consent text in that tool's description word for word and get a clear yes. Only then set `consent_to_contact` to true. Slots are Monday to Friday, 9:00 to 5:00 Central, 2 hours to 14 days out.
4. Never promise that a policy will be approved or that a claim will be paid, and never describe an estimate as a final price.
