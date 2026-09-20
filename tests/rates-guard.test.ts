import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { findBandGaps, findNullCells, loadRates } from "../src/mcp/lib/rates.js";
import { filledRates } from "./helpers.js";

describe("rates.json shape", () => {
  it("has complete 5-year bands for term 10/20/30 (18-70) and final expense (45-85)", () => {
    expect(findBandGaps(loadRates())).toEqual([]);
  });
  it("a filled table reports no null cells", () => {
    expect(findNullCells(filledRates())).toEqual([]);
  });
  it("RATES_VERIFIED=true with null cells fails the build script (deploy guard)", () => {
    const shipped = loadRates();
    const nulls = findNullCells(shipped);
    const run = (env: Record<string, string>) => {
      try {
        execFileSync("node", ["scripts/check-rates.mjs"], { env: { ...process.env, ...env }, stdio: "pipe" });
        return 0;
      } catch (e) {
        return (e as { status: number }).status;
      }
    };
    if (nulls.length > 0 || !shipped.verified) {
      expect(run({ RATES_VERIFIED: "true" })).toBe(1);
      expect(run({ RATES_VERIFIED: "" })).toBe(0);
    } else {
      expect(run({ RATES_VERIFIED: "true" })).toBe(0);
    }
  });
});
