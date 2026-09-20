// Loader for src/mcp/config/rates.json. Never invents numbers: any null cell,
// or verified=false, or RATES_VERIFIED != "true" in the environment, means the
// caller gets no estimate and must fall back to consultation_only.

import ratesJson from "../config/rates.json";

export type RateCell = { low: number | null; high: number | null };
export type RateBand = {
  age_min: number;
  age_max: number;
  non_tobacco: RateCell;
  tobacco: RateCell;
};
export type RatesTable = {
  verified: boolean;
  policy_fee_monthly: number | null;
  term: Record<string, RateBand[]>;
  final_expense: RateBand[];
};

export type RateLookup = { rate_low: number; rate_high: number; policy_fee: number };

export const PRODUCT_AGE_BANDS = {
  term: { min: 18, max: 70 },
  final_expense: { min: 45, max: 85 },
} as const;

export function loadRates(): RatesTable {
  return ratesJson as unknown as RatesTable;
}

/** True only when the environment explicitly says the table has been checked. */
export function ratesVerifiedInEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.RATES_VERIFIED === "true";
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

/**
 * Returns the per-$1,000 rates for a request, or null when the table cannot
 * answer it (unverified, missing band, or any null cell).
 */
export function lookupRate(
  table: RatesTable,
  args: { product_type: "term" | "final_expense"; age: number; tobacco: boolean; term_years?: number },
  env: NodeJS.ProcessEnv = process.env,
): RateLookup | null {
  if (!table.verified || !ratesVerifiedInEnv(env)) return null;
  if (!isNum(table.policy_fee_monthly)) return null;

  const bands =
    args.product_type === "term"
      ? table.term?.[String(args.term_years ?? 20)]
      : table.final_expense;
  if (!Array.isArray(bands)) return null;

  const band = bands.find((b) => args.age >= b.age_min && args.age <= b.age_max);
  if (!band) return null;

  const cell = args.tobacco ? band.tobacco : band.non_tobacco;
  if (!cell || !isNum(cell.low) || !isNum(cell.high)) return null;

  return { rate_low: cell.low, rate_high: cell.high, policy_fee: table.policy_fee_monthly };
}

/** Every cell in the table that must be filled before verified can be true. */
export function findNullCells(table: RatesTable): string[] {
  const missing: string[] = [];
  if (!isNum(table.policy_fee_monthly)) missing.push("policy_fee_monthly");
  const check = (path: string, bands: RateBand[] | undefined) => {
    if (!Array.isArray(bands)) {
      missing.push(path);
      return;
    }
    for (const b of bands) {
      for (const cls of ["non_tobacco", "tobacco"] as const) {
        for (const side of ["low", "high"] as const) {
          if (!isNum(b[cls]?.[side])) missing.push(`${path}[${b.age_min}-${b.age_max}].${cls}.${side}`);
        }
      }
    }
  };
  for (const yrs of ["10", "20", "30"]) check(`term.${yrs}`, table.term?.[yrs]);
  check("final_expense", table.final_expense);
  return missing;
}

/** Bands must tile the product's age range with no gaps or overlaps. */
export function findBandGaps(table: RatesTable): string[] {
  const problems: string[] = [];
  const check = (path: string, bands: RateBand[] | undefined, min: number, max: number) => {
    if (!Array.isArray(bands)) return;
    for (let age = min; age <= max; age++) {
      const hits = bands.filter((b) => age >= b.age_min && age <= b.age_max).length;
      if (hits !== 1) problems.push(`${path}: age ${age} matched ${hits} bands`);
    }
  };
  for (const yrs of ["10", "20", "30"]) check(`term.${yrs}`, table.term?.[yrs], PRODUCT_AGE_BANDS.term.min, PRODUCT_AGE_BANDS.term.max);
  check("final_expense", table.final_expense, PRODUCT_AGE_BANDS.final_expense.min, PRODUCT_AGE_BANDS.final_expense.max);
  return problems;
}
