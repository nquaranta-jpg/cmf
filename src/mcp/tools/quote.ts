// get_quote_estimate: a pure function over rates.json. No network, no state.

import { z } from "zod";
import {
  DISCLAIMER,
  MSG_AGE_OUT_OF_BAND,
  MSG_CONSULTATION_ONLY_PRODUCT,
  MSG_CONSULTATION_ONLY_RATES,
  MSG_NOT_LICENSED,
} from "../config/copy.js";
import { bandReason, loadRates, lookupRate, PRODUCT_AGE_BANDS, type RatesTable } from "../lib/rates.js";
import { isLicensedState } from "../lib/states.js";
import { normalizeState, US_STATE_CODES } from "../lib/sanitize.js";

export const PRODUCT_TYPES = ["term", "final_expense", "whole_life", "iul"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];
export const TERM_YEARS = [10, 20, 30] as const;

export const COVERAGE_LIMITS = {
  term: { min: 100_000, max: 2_000_000 },
  final_expense: { min: 5_000, max: 40_000 },
} as const;

/**
 * Advertised to agents in tools/list. Intentionally lenient on ranges so the
 * strict validator below can return a plain-English message that names the
 * field and the allowed range instead of the SDK's generic protocol error.
 */
export const quoteInputShape = {
  age: z.number().describe("Age in whole years, 18 to 85."),
  state: z.string().describe("Two-letter US state code where the person lives, for example IL."),
  tobacco: z.boolean().describe("True if the person used any nicotine or tobacco in the last 12 months."),
  product_type: z.enum(PRODUCT_TYPES).describe("term, final_expense, whole_life, or iul."),
  coverage_amount: z
    .number()
    .optional()
    .describe("Death benefit in whole dollars. term: 100000 to 2000000. final_expense: 5000 to 40000. Ignored for whole_life and iul."),
  term_years: z
    .number()
    .optional()
    .describe("Term length: 10, 20, or 30. Only for product_type term. Defaults to 20."),
};

export type QuoteInput = {
  age: number;
  state: string;
  tobacco: boolean;
  product_type: ProductType;
  coverage_amount?: number;
  term_years?: 10 | 20 | 30;
};

export type QuoteResult =
  | {
      status: "estimate";
      monthly_low: number;
      monthly_high: number;
      inputs_echo: QuoteInput;
      disclaimer: string;
      next_step: "book_consultation";
    }
  | {
      status: "consultation_only";
      message: string;
      inputs_echo: QuoteInput;
      disclaimer: string;
      next_step: "book_consultation";
    }
  | { status: "not_available"; message: string; inputs_echo: QuoteInput };

export type Validation<T> = { ok: true; data: T } | { ok: false; message: string };

const StrictQuoteSchema = z
  .object({
    age: z
      .number({ message: "age must be a whole number between 18 and 85." })
      .int("age must be a whole number between 18 and 85.")
      .min(18, "age must be between 18 and 85.")
      .max(85, "age must be between 18 and 85."),
    state: z
      .string({ message: "state must be a two-letter US state code, for example IL." })
      .transform(normalizeState)
      .refine((s) => US_STATE_CODES.has(s), "state must be a two-letter US state code, for example IL."),
    tobacco: z.boolean({ message: "tobacco must be true or false (nicotine use in the last 12 months)." }),
    product_type: z.enum(PRODUCT_TYPES, {
      message: "product_type must be one of: term, final_expense, whole_life, iul.",
    }),
    coverage_amount: z.number({ message: "coverage_amount must be a whole-dollar number." }).int("coverage_amount must be a whole-dollar number.").optional(),
    term_years: z.number().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.product_type === "term") {
      const yrs = v.term_years ?? 20;
      if (!(TERM_YEARS as readonly number[]).includes(yrs)) {
        ctx.addIssue({ code: "custom", path: ["term_years"], message: "term_years must be 10, 20, or 30." });
      }
      const { min, max } = COVERAGE_LIMITS.term;
      if (v.coverage_amount === undefined || v.coverage_amount < min || v.coverage_amount > max) {
        ctx.addIssue({
          code: "custom",
          path: ["coverage_amount"],
          message: `coverage_amount for term must be between ${min.toLocaleString("en-US")} and ${max.toLocaleString("en-US")} dollars.`,
        });
      }
    } else if (v.product_type === "final_expense") {
      const { min, max } = COVERAGE_LIMITS.final_expense;
      if (v.coverage_amount === undefined || v.coverage_amount < min || v.coverage_amount > max) {
        ctx.addIssue({
          code: "custom",
          path: ["coverage_amount"],
          message: `coverage_amount for final_expense must be between ${min.toLocaleString("en-US")} and ${max.toLocaleString("en-US")} dollars.`,
        });
      }
    }
  });

export function validateQuoteInput(raw: unknown): Validation<QuoteInput> {
  const parsed = StrictQuoteSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const field = first.path.join(".");
    const msg = first.message.startsWith(field) || !field ? first.message : `${field}: ${first.message}`;
    return { ok: false, message: msg };
  }
  const d = parsed.data;
  const data: QuoteInput = {
    age: d.age,
    state: d.state,
    tobacco: d.tobacco,
    product_type: d.product_type,
  };
  if (d.product_type === "term") {
    data.coverage_amount = d.coverage_amount;
    data.term_years = (d.term_years ?? 20) as 10 | 20 | 30;
  } else if (d.product_type === "final_expense") {
    data.coverage_amount = d.coverage_amount;
  }
  return { ok: true, data };
}

export type QuoteDeps = { rates?: RatesTable; env?: NodeJS.ProcessEnv; licensedStates?: string[] };

/** Runs the quote logic on already-validated input. */
export function computeQuote(input: QuoteInput, deps: QuoteDeps = {}): QuoteResult {
  const table = deps.rates ?? loadRates();
  const env = deps.env ?? process.env;

  if (!isLicensedState(input.state, deps.licensedStates ?? undefined)) {
    return { status: "not_available", message: MSG_NOT_LICENSED(input.state), inputs_echo: input };
  }

  if (input.product_type === "iul" || input.product_type === "whole_life") {
    return {
      status: "consultation_only",
      message: MSG_CONSULTATION_ONLY_PRODUCT,
      inputs_echo: input,
      disclaimer: DISCLAIMER,
      next_step: "book_consultation",
    };
  }

  const band = PRODUCT_AGE_BANDS[input.product_type];
  if (input.age < band.min || input.age > band.max) {
    const label = input.product_type === "term" ? "term life" : "final expense";
    return {
      status: "consultation_only",
      message: MSG_AGE_OUT_OF_BAND(label, band.min, band.max),
      inputs_echo: input,
      disclaimer: DISCLAIMER,
      next_step: "book_consultation",
    };
  }

  const rate = lookupRate(
    table,
    { product_type: input.product_type, age: input.age, tobacco: input.tobacco, term_years: input.term_years },
    env,
  );
  if (!rate) {
    const reason = bandReason(table, { product_type: input.product_type, age: input.age, term_years: input.term_years });
    return {
      status: "consultation_only",
      message: reason || MSG_CONSULTATION_ONLY_RATES,
      inputs_echo: input,
      disclaimer: DISCLAIMER,
      next_step: "book_consultation",
    };
  }

  const units = (input.coverage_amount as number) / 1000;
  const low = Math.round(units * rate.rate_low + rate.policy_fee);
  const high = Math.round(units * rate.rate_high + rate.policy_fee);
  return {
    status: "estimate",
    monthly_low: Math.min(low, high),
    monthly_high: Math.max(low, high),
    inputs_echo: input,
    disclaimer: DISCLAIMER,
    next_step: "book_consultation",
  };
}

/** Validate + compute. Returns either a result or a plain-English error message. */
export function getQuoteEstimate(raw: unknown, deps: QuoteDeps = {}): { result: QuoteResult } | { error: string } {
  const v = validateQuoteInput(raw);
  if (!v.ok) return { error: v.message };
  return { result: computeQuote(v.data, deps) };
}
