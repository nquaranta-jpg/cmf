// Task Board automation, every 2 minutes:
//   0. credit bond payments completed in Stripe Checkout
//   1. verify queued submissions (src/tasks/verify.ts) and apply the verdict
//   2. send owed payouts through Stripe to owners whose accounts are ready
//   3. close deal intros that never funded within 90 days
//
// Env: STRIPE_SECRET_KEY (payouts), TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN
// (phone lookups), ANTHROPIC_API_KEY (business-check judge). Each piece that
// lacks its key is skipped, never guessed.

import { getStore } from "@netlify/blobs";
import { verifySubmission, makeClaudeJudge, type VerifyDeps } from "../../src/tasks/verify.js";
import { runTaskBoardJobs } from "../../src/tasks/jobs.js";
import { makeStripe, accountReady } from "./lib/stripe.mjs";

export default async function handler(): Promise<Response> {
  const deps: VerifyDeps = {
    twilio: process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN ? { sid: process.env.TWILIO_ACCOUNT_SID, token: process.env.TWILIO_AUTH_TOKEN } : null,
    judge: makeClaudeJudge(),
  };
  const summary = await runTaskBoardJobs({
    store: getStore({ name: "taskboard", consistency: "strong" }) as any,
    stripe: makeStripe(),
    accountReady,
    verify: (t) => verifySubmission(t, deps),
    budgetMs: 20_000,
  });
  console.log(JSON.stringify({ src: "tasks-cron", ...summary }));
  return new Response(JSON.stringify(summary), { headers: { "Content-Type": "application/json" } });
}

export const config = { schedule: "*/2 * * * *" };
