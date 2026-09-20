// book_consultation: validates, then POSTs to the Apps Script booker with a
// shared secret. Fails closed on any transport or script error.

import { z } from "zod";
import {
  CONSENT_VERSION,
  MSG_BOOKING_UNAVAILABLE,
  MSG_CONSENT_REQUIRED,
  MSG_NOT_LICENSED,
} from "../config/copy.js";
import { isLicensedState } from "../lib/states.js";
import { cleanString, normalizeState, normalizeUsPhone, US_STATE_CODES } from "../lib/sanitize.js";
import { PRODUCT_TYPES, type ProductType, type Validation } from "./quote.js";

export const BOOKER_TIMEOUT_MS = 7000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
// ISO 8601 date-time with an explicit offset or Z.
const ISO_WITH_OFFSET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

export const bookInputShape = {
  first_name: z.string().describe("First name, 1 to 60 characters."),
  last_name: z.string().describe("Last name, 1 to 60 characters."),
  email: z.string().describe("Email address for the calendar invite and confirmation."),
  phone: z.string().describe("US phone number. Any common format; normalized to +1XXXXXXXXXX."),
  state: z.string().describe("Two-letter US state code where the person lives."),
  preferred_start: z
    .string()
    .describe("Requested start time as ISO 8601 with a UTC offset, for example 2026-09-22T14:00:00-05:00. Slots are 20 minutes, Monday to Friday, 9:00 to 17:00 Central, 2 hours to 14 days out."),
  consent_to_contact: z
    .boolean()
    .describe("True only if the user explicitly agreed to the consent text in this tool's description."),
  product_interest: z.enum(PRODUCT_TYPES).optional().describe("term, final_expense, whole_life, or iul."),
  quote_context: z
    .object({
      product_type: z.enum(PRODUCT_TYPES).optional(),
      coverage_amount: z.number().optional(),
      term_years: z.number().optional(),
      age: z.number().optional(),
      tobacco: z.boolean().optional(),
      monthly_low: z.number().optional(),
      monthly_high: z.number().optional(),
    })
    .optional()
    .describe("Echo of the quote inputs and range from get_quote_estimate, so the agent can prepare."),
  monthly_budget: z.number().optional().describe("What the person is comfortable paying per month, whole dollars."),
  is_decision_maker: z.boolean().optional().describe("True if this person can decide on the policy themselves."),
};

export type QuoteContext = {
  product_type?: ProductType;
  coverage_amount?: number;
  term_years?: number;
  age?: number;
  tobacco?: boolean;
  monthly_low?: number;
  monthly_high?: number;
};

export type BookInput = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  state: string;
  preferred_start: string;
  consent_to_contact: true;
  product_interest?: ProductType;
  quote_context?: QuoteContext;
  monthly_budget?: number;
  is_decision_maker?: boolean;
};

export type BookResult =
  | { status: "booked"; start: string; end: string; meet_link: string; confirmation_sent_to: string }
  | { status: "slot_unavailable"; message: string; alternatives: string[] }
  | { status: "already_booked"; message: string; start: string }
  | { status: "invalid_time"; message: string }
  | { status: "not_available"; message: string }
  | { status: "unavailable"; message: string };

const nameField = (label: string) =>
  z
    .string({ message: `${label} is required (1 to 60 characters).` })
    .transform((s) => cleanString(s, 60))
    .refine((s) => s.length >= 1, `${label} is required (1 to 60 characters).`);

const optInt = (label: string) =>
  z
    .number({ message: `${label} must be a whole number.` })
    .int(`${label} must be a whole number.`)
    .min(0, `${label} must be zero or more.`)
    .max(10_000_000, `${label} is out of range.`)
    .optional();

const StrictBookSchema = z.object({
  first_name: nameField("first_name"),
  last_name: nameField("last_name"),
  email: z
    .string({ message: "email must be a valid email address." })
    .transform((s) => cleanString(s, 254).toLowerCase())
    .refine((s) => EMAIL_RE.test(s), "email must be a valid email address."),
  phone: z
    .string({ message: "phone must be a valid 10-digit US phone number." })
    .transform((s) => normalizeUsPhone(cleanString(s, 40)))
    .refine((s): s is string => s !== null, "phone must be a valid 10-digit US phone number."),
  state: z
    .string({ message: "state must be a two-letter US state code, for example IL." })
    .transform(normalizeState)
    .refine((s) => US_STATE_CODES.has(s), "state must be a two-letter US state code, for example IL."),
  preferred_start: z
    .string({ message: "preferred_start must be an ISO 8601 date-time with a UTC offset, for example 2026-09-22T14:00:00-05:00." })
    .transform((s) => cleanString(s, 40))
    .refine(
      (s) => ISO_WITH_OFFSET_RE.test(s) && !Number.isNaN(Date.parse(s)),
      "preferred_start must be an ISO 8601 date-time with a UTC offset, for example 2026-09-22T14:00:00-05:00.",
    ),
  consent_to_contact: z.boolean({ message: MSG_CONSENT_REQUIRED }),
  product_interest: z.enum(PRODUCT_TYPES, { message: "product_interest must be one of: term, final_expense, whole_life, iul." }).optional(),
  quote_context: z
    .object({
      product_type: z.enum(PRODUCT_TYPES).optional(),
      coverage_amount: optInt("quote_context.coverage_amount"),
      term_years: optInt("quote_context.term_years"),
      age: optInt("quote_context.age"),
      tobacco: z.boolean().optional(),
      monthly_low: optInt("quote_context.monthly_low"),
      monthly_high: optInt("quote_context.monthly_high"),
    })
    .optional(),
  monthly_budget: optInt("monthly_budget"),
  is_decision_maker: z.boolean().optional(),
});

export function validateBookInput(raw: unknown): Validation<BookInput> {
  const parsed = StrictBookSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const field = first.path.join(".");
    const msg = first.message.startsWith(field) || !field || first.message === MSG_CONSENT_REQUIRED ? first.message : `${field}: ${first.message}`;
    return { ok: false, message: msg };
  }
  const d = parsed.data;
  if (d.consent_to_contact !== true) return { ok: false, message: MSG_CONSENT_REQUIRED };
  const data: BookInput = {
    first_name: d.first_name,
    last_name: d.last_name,
    email: d.email,
    phone: d.phone,
    state: d.state,
    preferred_start: d.preferred_start,
    consent_to_contact: true,
  };
  if (d.product_interest) data.product_interest = d.product_interest;
  if (d.quote_context) data.quote_context = d.quote_context;
  if (d.monthly_budget !== undefined) data.monthly_budget = d.monthly_budget;
  if (d.is_decision_maker !== undefined) data.is_decision_maker = d.is_decision_maker;
  return { ok: true, data };
}

export type BookDeps = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  licensedStates?: string[];
};

type BookerResponse = {
  status?: string;
  message?: string;
  start?: string;
  end?: string;
  meet_link?: string;
  confirmation_sent_to?: string;
  alternatives?: unknown;
};

/** Runs the booking on already-validated input. Never throws. */
export async function performBooking(input: BookInput, deps: BookDeps = {}): Promise<BookResult> {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => new Date());

  if (!isLicensedState(input.state, deps.licensedStates ?? undefined)) {
    return { status: "not_available", message: MSG_NOT_LICENSED(input.state) };
  }

  const url = env.BOOKER_URL;
  const secret = env.BOOKER_SECRET;
  if (!url || !secret) {
    return { status: "unavailable", message: MSG_BOOKING_UNAVAILABLE };
  }

  const payload = {
    secret,
    first_name: input.first_name,
    last_name: input.last_name,
    email: input.email,
    phone: input.phone,
    state: input.state,
    preferred_start: input.preferred_start,
    product_interest: input.product_interest ?? input.quote_context?.product_type ?? "",
    quote_context: input.quote_context ?? {},
    monthly_budget: input.monthly_budget ?? null,
    is_decision_maker: input.is_decision_maker ?? null,
    consent_to_contact: true,
    consent_timestamp: now().toISOString(),
    consent_version: CONSENT_VERSION,
    source: "muse",
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BOOKER_TIMEOUT_MS);
  let body: BookerResponse;
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) {
      return { status: "unavailable", message: MSG_BOOKING_UNAVAILABLE };
    }
    body = (await res.json()) as BookerResponse;
  } catch {
    return { status: "unavailable", message: MSG_BOOKING_UNAVAILABLE };
  } finally {
    clearTimeout(timer);
  }

  const str = (v: unknown, max = 400) => cleanString(typeof v === "string" ? v : "", max);

  switch (body?.status) {
    case "booked":
      return {
        status: "booked",
        start: str(body.start),
        end: str(body.end),
        meet_link: str(body.meet_link),
        confirmation_sent_to: str(body.confirmation_sent_to) || input.email,
      };
    case "slot_unavailable": {
      const alts = Array.isArray(body.alternatives)
        ? body.alternatives.filter((a): a is string => typeof a === "string").slice(0, 3)
        : [];
      return {
        status: "slot_unavailable",
        message: str(body.message) || "That time is not available. Here are the nearest open times.",
        alternatives: alts,
      };
    }
    case "already_booked":
      return {
        status: "already_booked",
        message: str(body.message) || "There is already an upcoming consultation booked for this email.",
        start: str(body.start),
      };
    case "invalid_time":
      return { status: "invalid_time", message: str(body.message) || "That time is outside the bookable window." };
    default:
      return { status: "unavailable", message: MSG_BOOKING_UNAVAILABLE };
  }
}

/** Validate + book. Returns either a result or a plain-English error message. */
export async function bookConsultation(raw: unknown, deps: BookDeps = {}): Promise<{ result: BookResult } | { error: string }> {
  const v = validateBookInput(raw);
  if (!v.ok) return { error: v.message };
  return { result: await performBooking(v.data, deps) };
}
