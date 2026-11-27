// Minimal Stripe REST client for the Task Board (no SDK, like the agent app).
// Uses CMF's Stripe account: STRIPE_SECRET_KEY (sk_test_... to test).
//
//   Connect Express accounts  -> where agent owners get paid
//   Transfers                 -> payouts, from CMF's Stripe balance to an owner
//   Checkout (mode=payment)   -> owners post a bond by card
//   Refunds                   -> unused bond goes back
//   Webhook signature check   -> checkout.session.completed credits the bond

import { createHmac, timingSafeEqual } from "node:crypto";

const API = "https://api.stripe.com/v1";

/** Stripe's form encoding: { a: { b: 1 }, c: [x] } -> a[b]=1&c[0]=x */
export function formEncode(obj, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => (typeof item === "object" ? formEncode(item, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(item))));
    else if (typeof v === "object") formEncode(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

export class StripeError extends Error {
  constructor(status, body) {
    super(body?.error?.message || `Stripe error ${status}`);
    this.status = status;
    this.code = body?.error?.code;
    this.type = body?.error?.type;
  }
}

/**
 * @param {{ key?: string, fetchImpl?: typeof fetch }} opts
 * Returns null when no key is configured, so callers can skip money steps cleanly.
 */
export function makeStripe({ key = process.env.STRIPE_SECRET_KEY, fetchImpl = fetch } = {}) {
  if (!key) return null;

  async function call(method, path, params, idempotencyKey) {
    const headers = { Authorization: `Bearer ${key}`, "Stripe-Version": "2024-06-20" };
    let url = `${API}${path}`;
    let body;
    if (method === "GET") {
      const q = formEncode(params).toString();
      if (q) url += `?${q}`;
    } else {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = formEncode(params).toString();
      if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    }
    const res = await fetchImpl(url, { method, headers, body, signal: AbortSignal.timeout(15000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new StripeError(res.status, data);
    return data;
  }

  return {
    testMode: key.startsWith("sk_test_") || key.startsWith("rk_test_"),

    createExpressAccount: ({ email, workerId }) =>
      call("POST", "/accounts", {
        type: "express",
        country: "US",
        email,
        capabilities: { transfers: { requested: true } },
        metadata: { worker_id: workerId, source: "cmf_taskboard" },
      }, `acct-${workerId}`),

    accountLink: ({ account, refreshUrl, returnUrl }) =>
      call("POST", "/account_links", { account, refresh_url: refreshUrl, return_url: returnUrl, type: "account_onboarding" }),

    getAccount: (id) => call("GET", `/accounts/${encodeURIComponent(id)}`),

    transfer: ({ amount, destination, taskId, ledgerId, attempt = 0 }) =>
      call("POST", "/transfers", {
        amount,
        currency: "usd",
        destination,
        transfer_group: taskId,
        description: `CMF Task Board payout ${taskId}`,
        metadata: { task_id: taskId, ledger_id: ledgerId, source: "cmf_taskboard" },
      }, `payout-${ledgerId}-${attempt}`),

    /** A transfer already made for this ledger entry, or null. */
    findTransfer: async ({ taskId, ledgerId }) => {
      const list = await call("GET", "/transfers", { transfer_group: taskId, limit: 20 });
      return (list.data || []).find((t) => t.metadata?.ledger_id === ledgerId && !t.reversed) || null;
    },

    bondCheckout: ({ workerId, cents, email, successUrl, cancelUrl }) =>
      call("POST", "/checkout/sessions", {
        mode: "payment",
        customer_email: email,
        success_url: successUrl,
        cancel_url: cancelUrl,
        line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: cents, product_data: { name: "CMF Task Board bond", description: "Refundable when unused. Forfeited for fabricated results." } } }],
        metadata: { purpose: "taskboard_bond", worker_id: workerId },
        payment_intent_data: { metadata: { purpose: "taskboard_bond", worker_id: workerId } },
      }),

    /** Completed Checkout sessions created since `sinceSec` (unix seconds), newest first, up to 100. */
    recentCheckoutSessions: (sinceSec) => call("GET", "/checkout/sessions", { limit: 100, status: "complete", created: { gte: sinceSec } }),

    refund: ({ paymentIntent, amount, idempotencyKey }) =>
      call("POST", "/refunds", { payment_intent: paymentIntent, amount, metadata: { purpose: "taskboard_bond_withdrawal" } }, idempotencyKey),
  };
}

/** True when an account can receive transfers. */
export function accountReady(acct) {
  return Boolean(acct && acct.capabilities?.transfers === "active" && acct.payouts_enabled !== false);
}

/**
 * Checks a Stripe-Signature header (t=...,v1=...) against the raw body.
 * Returns the parsed event, or null when the signature is missing, wrong or stale.
 */
export function verifyStripeWebhook(rawBody, header, secret, now = Date.now(), toleranceSec = 300) {
  if (!header || !secret) return null;
  const parts = Object.fromEntries(
    String(header)
      .split(",")
      .map((p) => p.split("="))
      .filter((p) => p.length === 2 && p[0] !== "v1"),
  );
  const sigs = String(header)
    .split(",")
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length || Math.abs(now / 1000 - t) > toleranceSec) return null;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const ok = sigs.some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
  if (!ok) return null;
  try {
    return JSON.parse(rawBody);
  } catch {
    return null;
  }
}
