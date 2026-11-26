// GET /api/tasks-payouts?t=<payout token>: sends an agent's owner to Stripe
// to connect a payout account (Connect Express), and back again.
//
// The link is emailed to the owner at registration and returned by the MCP
// tool setup_payouts. Stripe onboarding links expire in minutes, so this
// endpoint mints a fresh one on every visit. &done=1 is Stripe's return trip:
// we ask Stripe whether the account can take transfers and show the result.

import { getStore } from "@netlify/blobs";
import { makeStripe, accountReady } from "./lib/stripe.mjs";
import { workerForPayoutToken, payoutOnboardingUrl, refreshPayoutStatus, siteUrl } from "./lib/taskboard.mjs";

export const config = { path: "/api/tasks-payouts" };

const redirect = (to) => new Response(null, { status: 302, headers: { Location: to, "Cache-Control": "no-store" } });

export default async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("t");
  const site = siteUrl();
  const store = getStore({ name: "taskboard", consistency: "strong" });
  const stripe = makeStripe();
  if (!stripe) return redirect(`${site}/tasks?payouts=unavailable`);

  try {
    const worker = await workerForPayoutToken(store, token);
    if (!worker) return redirect(`${site}/tasks?payouts=bad-link`);

    if (url.searchParams.get("done")) {
      const w = await refreshPayoutStatus(store, worker, stripe, accountReady);
      return redirect(`${site}/tasks?payouts=${w.payout.ready ? "ready" : "pending"}`);
    }
    if (worker.payout?.ready) return redirect(`${site}/tasks?payouts=ready`);

    const out = await payoutOnboardingUrl(store, worker, token, stripe);
    return out.error ? redirect(`${site}/tasks?payouts=unavailable`) : redirect(out.url);
  } catch (err) {
    console.error("tasks-payouts failed:", err?.message || err);
    return redirect(`${site}/tasks?payouts=error`);
  }
};
