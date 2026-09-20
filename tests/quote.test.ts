import { describe, expect, it } from "vitest";
import { computeQuote, getQuoteEstimate, validateQuoteInput } from "../src/mcp/tools/quote.js";
import { loadRates } from "../src/mcp/lib/rates.js";
import { DISCLAIMER } from "../src/mcp/config/copy.js";
import { filledRates, UNVERIFIED_ENV, VERIFIED_ENV } from "./helpers.js";

const deps = { rates: filledRates(), env: VERIFIED_ENV };
const term = (over: Record<string, unknown> = {}) => ({ age: 35, state: "IL", tobacco: false, product_type: "term", coverage_amount: 500000, term_years: 20, ...over });
const fe = (over: Record<string, unknown> = {}) => ({ age: 62, state: "GA", tobacco: false, product_type: "final_expense", coverage_amount: 15000, ...over });

describe("get_quote_estimate: validation", () => {
  it("names the field and range for a bad age", () => {
    const out = getQuoteEstimate(term({ age: 17 }), deps);
    expect(out).toHaveProperty("error");
    expect((out as { error: string }).error).toMatch(/age/);
    expect((out as { error: string }).error).toMatch(/18/);
  });
  it("rejects 86 and accepts 85 (overall band)", () => {
    expect(getQuoteEstimate(fe({ age: 86 }), deps)).toHaveProperty("error");
    expect(getQuoteEstimate(fe({ age: 85 }), deps)).toHaveProperty("result");
  });
  it("rejects a non-integer age", () => {
    expect((getQuoteEstimate(term({ age: 35.5 }), deps) as { error: string }).error).toMatch(/whole number/);
  });
  it("rejects a bad state code but uppercases a valid one", () => {
    expect((getQuoteEstimate(term({ state: "Illinois" }), deps) as { error: string }).error).toMatch(/state/);
    const v = validateQuoteInput(term({ state: "il" }));
    expect(v.ok && v.data.state).toBe("IL");
  });
  it("rejects an unknown product type", () => {
    expect((getQuoteEstimate(term({ product_type: "annuity" }), deps) as { error: string }).error).toMatch(/product_type/);
  });
  it("enforces term coverage edges", () => {
    expect(getQuoteEstimate(term({ coverage_amount: 99999 }), deps)).toHaveProperty("error");
    expect(getQuoteEstimate(term({ coverage_amount: 100000 }), deps)).toHaveProperty("result");
    expect(getQuoteEstimate(term({ coverage_amount: 2000000 }), deps)).toHaveProperty("result");
    expect((getQuoteEstimate(term({ coverage_amount: 2000001 }), deps) as { error: string }).error).toMatch(/coverage_amount.*100,000.*2,000,000/);
  });
  it("enforces final expense coverage edges", () => {
    expect(getQuoteEstimate(fe({ coverage_amount: 4999 }), deps)).toHaveProperty("error");
    expect(getQuoteEstimate(fe({ coverage_amount: 5000 }), deps)).toHaveProperty("result");
    expect(getQuoteEstimate(fe({ coverage_amount: 40000 }), deps)).toHaveProperty("result");
    expect(getQuoteEstimate(fe({ coverage_amount: 40001 }), deps)).toHaveProperty("error");
  });
  it("requires coverage for term and final expense, ignores it for iul/whole_life", () => {
    expect(getQuoteEstimate(term({ coverage_amount: undefined }), deps)).toHaveProperty("error");
    const iul = getQuoteEstimate({ age: 40, state: "IL", tobacco: false, product_type: "iul" }, deps);
    expect(iul).toHaveProperty("result");
    const wl = getQuoteEstimate({ age: 40, state: "IL", tobacco: false, product_type: "whole_life", coverage_amount: 1 }, deps);
    expect(wl).toHaveProperty("result");
    expect((wl as { result: { inputs_echo: Record<string, unknown> } }).result.inputs_echo).not.toHaveProperty("coverage_amount");
  });
  it("term_years defaults to 20 and rejects 15", () => {
    const v = validateQuoteInput(term({ term_years: undefined }));
    expect(v.ok && v.data.term_years).toBe(20);
    expect((getQuoteEstimate(term({ term_years: 15 }), deps) as { error: string }).error).toMatch(/term_years/);
  });
});

describe("get_quote_estimate: statuses", () => {
  it("returns not_available with no next_step for an unlicensed state", () => {
    const r = computeQuote(validateQuoteInput(term({ state: "CA" })).ok ? (validateQuoteInput(term({ state: "CA" })) as { ok: true; data: never }).data : (undefined as never), deps);
    expect(r.status).toBe("not_available");
    expect((r as { message: string }).message).toMatch(/not currently licensed in CA/);
    expect(r).not.toHaveProperty("next_step");
  });
  it("unlicensed state wins even for iul", () => {
    const out = getQuoteEstimate({ age: 40, state: "CA", tobacco: false, product_type: "iul" }, deps);
    expect((out as { result: { status: string } }).result.status).toBe("not_available");
  });
  it("iul and whole_life are consultation_only with booking next step", () => {
    for (const product_type of ["iul", "whole_life"]) {
      const out = getQuoteEstimate({ age: 40, state: "IL", tobacco: true, product_type }, deps) as { result: Record<string, unknown> };
      expect(out.result.status).toBe("consultation_only");
      expect(out.result.next_step).toBe("book_consultation");
      expect(out.result.message).toMatch(/how the policy is designed/);
      expect(out.result.disclaimer).toBe(DISCLAIMER);
    }
  });
  it("term ages 18 and 70 estimate, 71 is consultation_only", () => {
    expect((getQuoteEstimate(term({ age: 18 }), deps) as { result: { status: string } }).result.status).toBe("estimate");
    expect((getQuoteEstimate(term({ age: 70 }), deps) as { result: { status: string } }).result.status).toBe("estimate");
    const r = (getQuoteEstimate(term({ age: 71 }), deps) as { result: { status: string; message: string } }).result;
    expect(r.status).toBe("consultation_only");
    expect(r.message).toMatch(/18 to 70/);
  });
  it("final expense ages 45 and 85 estimate, 44 is consultation_only", () => {
    expect((getQuoteEstimate(fe({ age: 45 }), deps) as { result: { status: string } }).result.status).toBe("estimate");
    expect((getQuoteEstimate(fe({ age: 85 }), deps) as { result: { status: string } }).result.status).toBe("estimate");
    const r = (getQuoteEstimate(fe({ age: 44 }), deps) as { result: { status: string; message: string } }).result;
    expect(r.status).toBe("consultation_only");
    expect(r.message).toMatch(/45 to 85/);
  });
  it("computes low/high = coverage/1000 * rate + fee, rounded", () => {
    // age 35 band: low 0.45, high 0.55 (see helpers), fee 5, coverage 500k
    const r = (getQuoteEstimate(term(), deps) as { result: Record<string, unknown> }).result;
    expect(r.status).toBe("estimate");
    expect(r.monthly_low).toBe(Math.round(500 * 0.45 + 5));
    expect(r.monthly_high).toBe(Math.round(500 * 0.55 + 5));
    expect(r.disclaimer).toBe(DISCLAIMER);
    expect(r.next_step).toBe("book_consultation");
    expect(r.inputs_echo).toEqual({ age: 35, state: "IL", tobacco: false, product_type: "term", coverage_amount: 500000, term_years: 20 });
  });
  it("tobacco uses the tobacco cell", () => {
    const nt = (getQuoteEstimate(term(), deps) as { result: { monthly_low: number } }).result.monthly_low;
    const t = (getQuoteEstimate(term({ tobacco: true }), deps) as { result: { monthly_low: number } }).result.monthly_low;
    expect(t).toBeGreaterThan(nt);
  });
  it("term_years selects the matching table", () => {
    const rates = filledRates();
    rates.term["30"][3].non_tobacco = { low: 9, high: 10 };
    const r = (getQuoteEstimate(term({ term_years: 30 }), { rates, env: VERIFIED_ENV }) as { result: { monthly_low: number } }).result;
    expect(r.monthly_low).toBe(500 * 9 + 5);
  });
});

describe("get_quote_estimate: rate table guards", () => {
  it("falls back to consultation_only when a needed cell is null", () => {
    const rates = filledRates();
    rates.term["20"][3].non_tobacco.high = null;
    const r = (getQuoteEstimate(term(), { rates, env: VERIFIED_ENV }) as { result: { status: string; next_step: string } }).result;
    expect(r.status).toBe("consultation_only");
    expect(r.next_step).toBe("book_consultation");
  });
  it("falls back when the policy fee is null", () => {
    const rates = filledRates();
    rates.policy_fee_monthly = null;
    expect((getQuoteEstimate(term(), { rates, env: VERIFIED_ENV }) as { result: { status: string } }).result.status).toBe("consultation_only");
  });
  it("falls back when rates.json says verified=false", () => {
    const rates = filledRates();
    rates.verified = false;
    expect((getQuoteEstimate(term(), { rates, env: VERIFIED_ENV }) as { result: { status: string } }).result.status).toBe("consultation_only");
  });
  it("falls back when RATES_VERIFIED is not 'true' in the environment", () => {
    expect((getQuoteEstimate(term(), { rates: filledRates(), env: UNVERIFIED_ENV }) as { result: { status: string } }).result.status).toBe("consultation_only");
    expect((getQuoteEstimate(term(), { rates: filledRates(), env: { RATES_VERIFIED: "TRUE" } as NodeJS.ProcessEnv }) as { result: { status: string } }).result.status).toBe("consultation_only");
  });
  it("the shipped rates.json never yields a number until it is filled in", () => {
    const shipped = loadRates();
    const r = (getQuoteEstimate(term(), { rates: shipped, env: VERIFIED_ENV }) as { result: { status: string } }).result;
    if (shipped.verified) {
      expect(["estimate", "consultation_only"]).toContain(r.status);
    } else {
      expect(r.status).toBe("consultation_only");
    }
  });
});

describe("get_quote_estimate: consultation-only bands", () => {
  it("a band flagged consultation_only answers with its reason instead of a number", () => {
    const rates = filledRates();
    rates.term["30"][8] = { age_min: 60, age_max: 64, consultation_only: true, reason: "Not issued at this age.", non_tobacco: { low: null, high: null }, tobacco: { low: null, high: null } };
    const r = (getQuoteEstimate(term({ age: 62, term_years: 30 }), { rates, env: VERIFIED_ENV }) as { result: Record<string, unknown> }).result;
    expect(r.status).toBe("consultation_only");
    expect(r.message).toBe("Not issued at this age.");
    expect(r.next_step).toBe("book_consultation");
    // Other term lengths at the same age still price.
    expect((getQuoteEstimate(term({ age: 62, term_years: 20 }), { rates, env: VERIFIED_ENV }) as { result: { status: string } }).result.status).toBe("estimate");
  });
  it("the shipped table prices 20-year term at 35 and final expense at 62 once RATES_VERIFIED is on", () => {
    const shipped = loadRates();
    if (!shipped.verified) return;
    const a = (getQuoteEstimate(term(), { rates: shipped, env: VERIFIED_ENV }) as unknown as { result: Record<string, number | string> }).result;
    expect(a.status).toBe("estimate");
    expect(a.monthly_low).toBeGreaterThan(10);
    expect(a.monthly_high).toBeGreaterThan(a.monthly_low as number);
    const b = (getQuoteEstimate(fe(), { rates: shipped, env: VERIFIED_ENV }) as { result: { status: string } }).result;
    expect(b.status).toBe("estimate");
    expect((getQuoteEstimate(term(), { rates: shipped, env: UNVERIFIED_ENV }) as { result: { status: string } }).result.status).toBe("consultation_only");
  });
});
