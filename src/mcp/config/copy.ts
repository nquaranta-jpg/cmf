// Single source of truth for every piece of compliance copy the connector
// emits. tests/copy.test.ts greps this file, the tool descriptions, and
// /connect/muse for carrier names, "guaranteed", "best rates", "lowest price",
// growth claims, and em dashes. Keep all customer-facing wording here.

export const AGENCY_NAME = "Crown Merchant Financial";
export const AGENCY_LEGAL_NAME = "Crown Merchant Financial LLC";
export const SUPPORT_EMAIL = "nquaranta@crownmerchantfinancial.com";
export const SUPPORT_PHONE = "(312) 203-8106";
export const SITE_URL = "https://crownmerchantfinancial.com";

export const DISCLAIMER =
  "This is an estimate, not an offer of coverage. Your actual premium depends on underwriting and approval by the insurance company, and may be higher or lower. Crown Merchant Financial LLC is a licensed independent life insurance agency based in Illinois. License information available on request.";

export const CONSENT_VERSION = "CONSENT_V1";
export const CONSENT_TEXT =
  "I agree that Crown Merchant Financial may contact me by phone, text, and email at the number and address I provided about my life insurance request. Consent is not a condition of purchase. Message and data rates may apply. Reply STOP to opt out of texts.";

export const QUOTE_TOOL_TITLE = "Life Insurance Quote Estimate";
export const QUOTE_TOOL_DESCRIPTION =
  "Returns an estimated monthly premium range for life insurance from Crown Merchant Financial, a licensed independent life insurance agency. Estimates only, not an offer of coverage. Always show the user the disclaimer returned with the result. If the user wants exact pricing or wants to apply, offer to book a free consultation with the book_consultation tool.";

export const BOOK_TOOL_TITLE = "Book a Life Insurance Consultation";
export const BOOK_TOOL_DESCRIPTION =
  `Books a free 20-minute video consultation with a licensed agent at Crown Merchant Financial. Before calling this tool you must show the user the consent text below and get their explicit yes. Only set consent_to_contact to true if the user agreed. Consent text: "${CONSENT_TEXT}"`;

export const MSG_NOT_LICENSED = (state: string) =>
  `Crown Merchant Financial is not currently licensed in ${state}. We cannot provide a quote or book a consultation there.`;

export const MSG_CONSULTATION_ONLY_PRODUCT =
  "Pricing for this product depends on how the policy is designed, so we do not give automated estimates. A licensed agent can walk you through real numbers in a free 20-minute call.";

export const MSG_CONSULTATION_ONLY_RATES =
  "Automated estimates are not available right now. A licensed agent can give you real numbers in a free 20-minute call.";

export const MSG_AGE_OUT_OF_BAND = (product: string, min: number, max: number) =>
  `Automated ${product} estimates cover ages ${min} to ${max}. A licensed agent can review options for your age in a free 20-minute call.`;

export const MSG_CONSENT_REQUIRED = "The user must agree to the consent text before booking.";

export const MSG_BOOKING_UNAVAILABLE =
  "Booking is temporarily unavailable. You can book directly at crownmerchantfinancial.com";

export const MSG_RATE_LIMITED =
  "Too many requests from this address. Please wait a few minutes and try again.";

export const WHAT_TO_EXPECT =
  "On the call a licensed agent will review your goals, confirm the details behind your estimate, and answer questions. There is no obligation.";
