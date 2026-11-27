// Types for lib/coverage.mjs.
import type { Worker, CoveragePolicy, LedgerEntry } from "./taskboard.mjs";

export interface CoverageConfig {
  name: string;
  issuer: string;
  license: string;
  terms_url: string;
  term_days: number;
  tiers: Record<string, { max_cents: number; rate_bps: number }>;
  pay_url: string | null;
  capital_cents: number;
}
export interface TrackRecord { verified: number; rejected: number; fraud: number; reject_rate: number; age_days: number; tier: "new" | "established" | "trusted" | "ineligible" }

export const TIER_RULES: Record<string, { min_verified: number; max_reject_rate: number }>;
export function coverageConfig(env?: Record<string, string | undefined>): CoverageConfig | null;
export function publicCoverage(cfg: CoverageConfig | null): Record<string, any>;
export function trackRecord(w: Worker | null | undefined, now?: number): TrackRecord;
export function coverageCapacity(w: Worker | null | undefined, now?: number): number;
export function quoteCoverage(w: Worker, amountCents: number, cfg: CoverageConfig | null, now?: number): Record<string, any>;
export function startPolicy(w: Worker, quote: Record<string, any>, policyId: string, now?: number): { policy: CoveragePolicy } | { error: string };
export function premiumDue(w: Worker | null | undefined): number;
export function applyPremium(w: Worker, availableCents: number, now?: number): { deducted: number; activated: boolean; policy?: CoveragePolicy };
export function claimCoverage(w: Worker, amount: number, now?: number): { paid: number; policies: { policy_id: string; cents: number }[] };
export function coverageBook(ledger: LedgerEntry[], workers: Worker[], cfg: CoverageConfig | null): Record<string, number>;
