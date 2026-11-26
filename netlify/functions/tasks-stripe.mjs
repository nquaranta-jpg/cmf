// POST /api/tasks-stripe: OPTIONAL Stripe webhook for the Task Board. Bonds
// are already credited by the every-2-minutes job (reconcileBonds), which
// needs only STRIPE_SECRET_KEY; this endpoint just makes it instant.
//
// Stripe Dashboard > Developers > Webhooks > Add endpoint
//   https://crownmerchantfinancial.com/api/tasks-stripe
//   events: checkout.session.completed, checkout.session.async_payment_succeeded
// Its signing secret goes in STRIPE_TASKS_WEBHOOK_SECRET.
//
// Only Checkout sessions tagged purpose=taskboard_bond are handled here (the
// agent app's Lead Store has its own endpoint); everything else is acknowledged
// and ignored.

import { getStore } from "@netlify/blobs";
import { verifyStripeWebhook } from "./lib/stripe.mjs";
import { creditBondDeposit, bondCents, fmtUsd, sendTelegram } from "./lib/taskboard.mjs";

export const config = { path: "/api/tasks-stripe" };

const ok = () => new Response(JSON.stringify({ received: true }), { status: 200, headers: { "Content-Type": "application/json" } });

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const raw = await req.text();
  const event = verifyStripeWebhook(raw, req.headers.get("stripe-signature"), process.env.STRIPE_TASKS_WEBHOOK_SECRET);
  if (!event) return new Response("Bad signature", { status: 400 });

  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") return ok();
  const s = event.data?.object || {};
  if (s.metadata?.purpose !== "taskboard_bond") return ok();
  // Card payments arrive "paid" on completed; ACH-style payments arrive later on async_payment_succeeded.
  if (s.payment_status !== "paid") return ok();

  try {
    const store = getStore({ name: "taskboard", consistency: "strong" });
    const out = await creditBondDeposit(store, s.metadata.worker_id, { paymentIntent: s.payment_intent, cents: s.amount_total });
    if (out.error) {
      console.error("tasks-stripe: bond not credited:", out.error, s.id);
      return ok();
    }
    if (!out.duplicate) await sendTelegram(`💵 Task Board: bond posted\n${out.worker.agent_name} (${out.worker.owner_name}) +${fmtUsd(s.amount_total)}, now ${fmtUsd(bondCents(out.worker))}`);
    return ok();
  } catch (err) {
    console.error("tasks-stripe failed:", err);
    return new Response("Server error", { status: 500 }); // Stripe retries
  }
};
