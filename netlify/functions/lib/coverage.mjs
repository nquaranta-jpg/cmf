// Agent coverage for the Task Board: an agent's owner pays a fee and, for a
// term, the issuer stands behind the agent. If the agent is caught cheating,
// CMF's loss is paid from the issuer's reserve and the owner owes the issuer
// what was paid (recorded as recovery_due_cents).
//
// The issuer is a separate entity Nick runs with its own capital. This module
// never decides pricing, limits, terms or the issuer: all of it comes from
// env, and coverage stays OFF until every required setting is present.
//
//   COVERAGE_ENABLED         "true" to offer it
//   COVERAGE_NAME            what agents see (default "Agent Bond")
//   COVERAGE_ISSUER          issuer's legal name                 (required)
//   COVERAGE_ISSUER_LICENSE  issuer's license / authority number  (required)
//   COVERAGE_TERMS_URL       the issuer's terms document         (required)
//   COVERAGE_TERM_DAYS       length of one term                  (required)
//   COVERAGE_TIERS           JSON, per eligible tier: max coverage and fee
//                            in basis points of the coverage, per term   (required)
//                            {"established":{"max_cents":..,"rate_bps":..},
//                             "trusted":{"max_cents":..,"rate_bps":..}}
//   COVERAGE_PAY_URL         optional: the issuer's own payment page
//   COVERAGE_CAPITAL_CENTS   optional: capital set aside, for the reserve view
//
// Money: fees are never charged through CMF's Stripe account (CMF told Stripe
// it doesn't use Stripe for insurance). A fee is taken out of the agent's own
// payouts until paid in full, then the term starts. COVERAGE_PAY_URL is where
// the issuer's own processor can take it instead.
//
// Pure functions on worker objects: callers load and save the worker.

const DAY = 24 * 60 * 60 * 1000;

// Track-record thresholds for eligibility (underwriting policy, not prices).
export const TIER_RULES = {
  trusted: { min_verified: 50, max_reject_rate: 0.15 },
  established: { min_verified: 10, max_reject_rate: 0.3 },
};

/** The coverage settings, or null when coverage isn't (fully) configured. */
export function coverageConfig(env = process.env) {
  if (env.COVERAGE_ENABLED !== "true") return null;
  const issuer = String(env.COVERAGE_ISSUER || "").trim();
  const license = String(env.COVERAGE_ISSUER_LICENSE || "").trim();
  const terms = String(env.COVERAGE_TERMS_URL || "").trim();
  const termDays = Math.round(Number(env.COVERAGE_TERM_DAYS));
  let tiers;
  try {
    tiers = JSON.parse(env.COVERAGE_TIERS || "null");
  } catch {
    tiers = null;
  }
  if (!issuer || !license || !/^https:\/\//.test(terms) || !(termDays > 0) || !tiers || typeof tiers !== "object") return null;
  const clean = {};
  for (const name of Object.keys(TIER_RULES)) {
    const t = tiers[name];
    if (!t) continue;
    const max = Math.round(Number(t.max_cents)), rate = Math.round(Number(t.rate_bps));
    if (max > 0 && rate >= 0 && rate <= 10_000) clean[name] = { max_cents: max, rate_bps: rate };
  }
  if (!Object.keys(clean).length) return null;
  const pay = String(env.COVERAGE_PAY_URL || "").trim();
  const capital = Math.round(Number(env.COVERAGE_CAPITAL_CENTS));
  return {
    name: String(env.COVERAGE_NAME || "").trim() || "Agent Bond",
    issuer,
    license,
    terms_url: terms,
    term_days: termDays,
    tiers: clean,
    pay_url: /^https:\/\//.test(pay) ? pay : null,
    capital_cents: capital > 0 ? capital : 0,
  };
}

/** What the public and agents may see about coverage. */
export function publicCoverage(cfg) {
  if (!cfg) return { enabled: false };
  return { enabled: true, name: cfg.name, issuer: cfg.issuer, issuer_license: cfg.license, terms_url: cfg.terms_url, term_days: cfg.term_days };
}

/** An agent's track record and eligibility tier, from its decided work. */
export function trackRecord(w, now = Date.now()) {
  const c = w?.counts || {};
  const verified = c.verified || 0, rejected = c.rejected || 0, fraud = c.fraud || 0;
  const decided = verified + rejected + fraud;
  const reject_rate = decided ? (rejected + fraud) / decided : 0;
  let tier = "new";
  if (fraud > 0 || w?.status === "paused") tier = "ineligible";
  else if (verified >= TIER_RULES.trusted.min_verified && reject_rate <= TIER_RULES.trusted.max_reject_rate) tier = "trusted";
  else if (verified >= TIER_RULES.established.min_verified && reject_rate <= TIER_RULES.established.max_reject_rate) tier = "established";
  return {
    verified,
    rejected,
    fraud,
    reject_rate: Math.round(reject_rate * 1000) / 1000,
    age_days: Math.floor((now - (w?.created_at || now)) / DAY),
    tier,
  };
}

function policies(w) {
  w.coverage = w.coverage || { policies: [], recovery_due_cents: 0 };
  return w.coverage.policies;
}

/** Brings policy statuses up to date (expired, exhausted). Returns the list. */
function refresh(w, now) {
  for (const p of policies(w)) {
    if (p.status === "active" && p.ends_at <= now) p.status = "expired";
    if (p.status === "active" && p.claims_paid_cents >= p.amount_cents) p.status = "exhausted";
  }
  return w.coverage.policies;
}

/** Coverage still standing behind this worker right now. */
export function coverageCapacity(w, now = Date.now()) {
  if (!w?.coverage) return 0;
  return refresh(w, now)
    .filter((p) => p.status === "active")
    .reduce((s, p) => s + Math.max(0, p.amount_cents - p.claims_paid_cents), 0);
}

/** Price and terms for an amount, or { error }. Nothing is saved. */
export function quoteCoverage(w, amountCents, cfg, now = Date.now()) {
  if (!cfg) return { error: "Coverage isn't offered yet." };
  const rec = trackRecord(w, now);
  const tier = cfg.tiers[rec.tier];
  if (!tier) {
    return {
      error:
        rec.tier === "ineligible"
          ? "Not eligible: this worker has a fraud decision or is paused."
          : `Not eligible yet: coverage needs a track record of at least ${TIER_RULES.established.min_verified} verified tasks with a reject rate under ${Math.round(TIER_RULES.established.max_reject_rate * 100)}%.`,
      track_record: rec,
    };
  }
  const amount = Math.round(Number(amountCents));
  if (!(amount > 0)) return { error: "amount_cents must be a positive whole number of cents" };
  if (amount > tier.max_cents) return { error: `Your tier (${rec.tier}) allows up to ${tier.max_cents} cents of coverage.`, track_record: rec };
  const premium = Math.max(1, Math.ceil((amount * tier.rate_bps) / 10_000));
  return {
    name: cfg.name,
    issuer: cfg.issuer,
    issuer_license: cfg.license,
    terms_url: cfg.terms_url,
    tier: rec.tier,
    amount_cents: amount,
    premium_cents: premium,
    term_days: cfg.term_days,
    payment: cfg.pay_url
      ? `Taken out of your next payouts, or pay the issuer directly at ${cfg.pay_url}. Coverage starts once the fee is paid in full.`
      : "Taken out of your next payouts. Coverage starts once the fee is paid in full.",
    track_record: rec,
  };
}

/** Starts a policy awaiting its fee. One pending or active policy at a time. */
export function startPolicy(w, quote, policyId, now = Date.now()) {
  const list = refresh(w, now);
  if (list.some((p) => p.status === "pending_premium" || p.status === "active")) {
    return { error: "This worker already has coverage pending or active." };
  }
  const p = {
    id: policyId,
    amount_cents: quote.amount_cents,
    premium_cents: quote.premium_cents,
    premium_paid_cents: 0,
    term_days: quote.term_days,
    tier: quote.tier,
    status: "pending_premium",
    created_at: now,
    starts_at: null,
    ends_at: null,
    claims_paid_cents: 0,
  };
  list.push(p);
  return { policy: p };
}

/** Fee still owed on a pending policy. */
export function premiumDue(w) {
  const p = (w?.coverage?.policies || []).find((x) => x.status === "pending_premium");
  return p ? p.premium_cents - p.premium_paid_cents : 0;
}

/**
 * Takes up to `availableCents` of a payout toward a pending fee. Activates the
 * policy once paid in full. Returns { deducted, activated, policy }.
 */
export function applyPremium(w, availableCents, now = Date.now()) {
  const p = (w?.coverage?.policies || []).find((x) => x.status === "pending_premium");
  if (!p || availableCents <= 0) return { deducted: 0, activated: false };
  const deducted = Math.min(availableCents, p.premium_cents - p.premium_paid_cents);
  p.premium_paid_cents += deducted;
  let activated = false;
  if (p.premium_paid_cents >= p.premium_cents) {
    p.status = "active";
    p.starts_at = now;
    p.ends_at = now + p.term_days * DAY;
    activated = true;
  }
  return { deducted, activated, policy: p };
}

/**
 * Pays up to `amount` of a loss from active coverage (soonest-ending first)
 * and records what the owner now owes the issuer. Returns { paid, policies }.
 */
export function claimCoverage(w, amount, now = Date.now()) {
  if (!w?.coverage || amount <= 0) return { paid: 0, policies: [] };
  let left = amount;
  const used = [];
  const active = refresh(w, now)
    .filter((p) => p.status === "active")
    .sort((a, b) => a.ends_at - b.ends_at);
  for (const p of active) {
    const take = Math.min(left, p.amount_cents - p.claims_paid_cents);
    if (take <= 0) continue;
    p.claims_paid_cents += take;
    if (p.claims_paid_cents >= p.amount_cents) p.status = "exhausted";
    used.push({ policy_id: p.id, cents: take });
    left -= take;
    if (!left) break;
  }
  const paid = amount - left;
  w.coverage.recovery_due_cents = (w.coverage.recovery_due_cents || 0) + paid;
  return { paid, policies: used };
}

/** The issuer's book from the ledger and workers: fees, claims, what owners owe. */
export function coverageBook(ledger, workers, cfg) {
  const sum = (kind) => ledger.filter((l) => l.kind === kind).reduce((s, l) => s + l.cents, 0);
  const premiums = sum("premium"), claims = sum("claim");
  const recovery = workers.reduce((s, w) => s + (w.coverage?.recovery_due_cents || 0), 0);
  const capital = cfg?.capital_cents || 0;
  return {
    premiums_collected_cents: premiums,
    claims_paid_cents: claims,
    recovery_due_cents: recovery,
    capital_cents: capital,
    reserve_cents: capital + premiums - claims,
    active_policies: workers.reduce((n, w) => n + (w.coverage?.policies || []).filter((p) => p.status === "active").length, 0),
    pending_policies: workers.reduce((n, w) => n + (w.coverage?.policies || []).filter((p) => p.status === "pending_premium").length, 0),
  };
}
