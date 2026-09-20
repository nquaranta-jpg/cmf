// Build-time guard (runs in the Netlify build command, no dependencies).
// Fails the deploy if RATES_VERIFIED=true while rates.json still has null
// cells, has verified=false, or has age-band gaps. With RATES_VERIFIED unset
// it only warns, because the connector then answers consultation_only.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const table = JSON.parse(readFileSync(join(here, "..", "src", "mcp", "config", "rates.json"), "utf8"));

const isNum = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
const problems = [];

if (!isNum(table.policy_fee_monthly)) problems.push("policy_fee_monthly is null");

const checkBands = (path, bands, min, max) => {
  if (!Array.isArray(bands)) return problems.push(`${path} missing`);
  for (const b of bands) {
    for (const cls of ["non_tobacco", "tobacco"]) {
      for (const side of ["low", "high"]) {
        if (!isNum(b?.[cls]?.[side])) problems.push(`${path}[${b.age_min}-${b.age_max}].${cls}.${side} is null`);
      }
    }
  }
  for (let age = min; age <= max; age++) {
    const hits = bands.filter((b) => age >= b.age_min && age <= b.age_max).length;
    if (hits !== 1) problems.push(`${path}: age ${age} matched ${hits} bands`);
  }
};
for (const yrs of ["10", "20", "30"]) checkBands(`term.${yrs}`, table.term?.[yrs], 18, 70);
checkBands("final_expense", table.final_expense, 45, 85);
if (table.verified !== true) problems.push("rates.json verified is not true");

const envVerified = process.env.RATES_VERIFIED === "true";
if (problems.length === 0) {
  console.log("check-rates: rates.json is complete." + (envVerified ? " RATES_VERIFIED=true, estimates enabled." : " RATES_VERIFIED is not true, so estimates stay off."));
  process.exit(0);
}
if (envVerified) {
  console.error(`check-rates: RATES_VERIFIED=true but rates.json is not ready (${problems.length} problems). First few:`);
  for (const p of problems.slice(0, 15)) console.error("  - " + p);
  process.exit(1);
}
console.log(`check-rates: rates.json has ${problems.length} open items; connector will answer consultation_only until they are filled and RATES_VERIFIED=true.`);
