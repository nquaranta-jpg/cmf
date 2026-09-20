import type { RatesTable, RateBand } from "../src/mcp/lib/rates.js";

const band = (min: number, max: number, lowNT: number, highNT: number): RateBand => ({
  age_min: min,
  age_max: max,
  non_tobacco: { low: lowNT, high: highNT },
  tobacco: { low: lowNT * 2, high: highNT * 2 },
});

const termBands = (): RateBand[] =>
  [[18, 24], [25, 29], [30, 34], [35, 39], [40, 44], [45, 49], [50, 54], [55, 59], [60, 64], [65, 70]].map(([a, b]) =>
    band(a, b, 0.1 + a / 100, 0.2 + a / 100),
  );

const feBands = (): RateBand[] =>
  [[45, 49], [50, 54], [55, 59], [60, 64], [65, 69], [70, 74], [75, 79], [80, 85]].map(([a, b]) => band(a, b, 2 + a / 10, 3 + a / 10));

/** A fully populated, verified rate table with deterministic numbers. */
export function filledRates(): RatesTable {
  return {
    verified: true,
    policy_fee_monthly: 5,
    term: { "10": termBands(), "20": termBands(), "30": termBands() },
    final_expense: feBands(),
  };
}

export const VERIFIED_ENV = { RATES_VERIFIED: "true" } as NodeJS.ProcessEnv;
export const UNVERIFIED_ENV = {} as NodeJS.ProcessEnv;

export const validBooking = () => ({
  first_name: "Test",
  last_name: "Person",
  email: "test@example.com",
  phone: "(312) 555-0142",
  state: "IL",
  preferred_start: "2026-09-22T14:00:00-05:00",
  consent_to_contact: true,
  product_interest: "term",
  quote_context: { product_type: "term", coverage_amount: 500000, term_years: 20, monthly_low: 30, monthly_high: 45 },
  monthly_budget: 50,
  is_decision_maker: true,
});

export function fakeFetch(body: unknown, init: { ok?: boolean; status?: number; throws?: boolean; delayMs?: number } = {}) {
  const calls: { url: string; body: unknown }[] = [];
  const fn = (async (url: string | URL | Request, opts?: RequestInit) => {
    calls.push({ url: String(url), body: opts?.body ? JSON.parse(String(opts.body)) : undefined });
    if (init.throws) throw new Error("connect ECONNREFUSED");
    if (init.delayMs) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, init.delayMs);
        opts?.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    }
    return new Response(JSON.stringify(body), {
      status: init.status ?? (init.ok === false ? 500 : 200),
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}
