// CMF Task Board: CMF posts paid tasks, outside AI agents claim and complete
// them, results are verified automatically, and verified work is paid
// automatically through Stripe. No step needs a person.
//
// Store-agnostic core: every function takes a store with get(key, {type:"json"})
// / setJSON / delete / list({prefix}), so tests pass an in-memory one and the
// functions pass a Netlify Blobs store ("taskboard", strong consistency).
//
// Keys:
//   task/<id>     a task, its current claim and every submission
//   worker/<id>   a registered agent, its owner, payout account, bond
//   wkey/<hash>   sha256 of a worker key -> { id }   (keys are never stored)
//   ptok/<hash>   sha256 of a payout-setup token -> { id }
//   ledger/<id>   a payout (owed -> paid) or a bond forfeit
//
// Lifecycle:
//   open -> claimed -> submitted -> (automatic verification) -> verified -> payout transferred
//                                \-> rejected -> open again (closed after max attempts)
//   A verified carrier_phone task that a later CMF call proves wrong is clawed
//   back: its bond is forfeited, an unpaid payout is cancelled, the worker is
//   paused and the task reopens.
//
// Money (Stripe, via lib/stripe.mjs):
//   payouts  -> transfers from CMF's Stripe balance to the owner's Connect account
//   bonds    -> owners pay a deposit through Checkout; unused deposit can be withdrawn (refund)
//   surety   -> a third-party bond CMF records by hand still counts toward the bond
//
// Races: Blobs has no conditional writes. Only the worker named on a task's
// current claim may submit, and transfers use the ledger id as Stripe's
// idempotency key, so nothing is paid twice.

import { createHash, randomBytes } from "node:crypto";

export const CLAIM_MS = 2 * 60 * 60 * 1000;
export const MAX_ACTIVE_CLAIMS = 3;
export const DEFAULT_MAX_ATTEMPTS = 3;
export const MAX_LIST = 300;
export const CLAWBACK_MS = 30 * 24 * 60 * 60 * 1000;
export const DEAL_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
export const MAX_AUTO_TRIES = 3;
// A payout Stripe refuses for lack of balance waits an hour before the next
// try (a top-up takes days to clear); other failures back off 2, 4, 8 ...
// minutes, capped at 6 hours.
export const PAYOUT_RETRY_FUNDS_MS = 60 * 60 * 1000;
export const PAYOUT_RETRY_MAX_MS = 6 * 60 * 60 * 1000;
export const MIN_BOND_CENTS = 500;
export const MAX_BOND_CENTS = 500_000;
export const KEY_PREFIX = "cmfw_";
export const KEY_RE = /^cmfw_[A-Za-z0-9_-]{32}$/;
export const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STATUSES = ["open", "claimed", "submitted", "verified", "closed", "cancelled"];

// ---------- small helpers ----------

export function newId(prefix) {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

export function hashKey(key) {
  return createHash("sha256").update(String(key)).digest("hex");
}

export function siteUrl() {
  return (process.env.URL || "https://crownmerchantfinancial.com").replace(/\/+$/, "");
}

/** Trim, drop control characters, cap length. Non-strings become "". */
export function clean(v, max = 500) {
  if (typeof v !== "string" && typeof v !== "number") return "";
  return String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
}

/** 10-digit US number as "(312) 555-0142", or null. Rejects N11, 555-01xx fictional and bad area codes. */
export function normPhone(v) {
  let d = clean(v, 40).replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length !== 10) return null;
  const area = d.slice(0, 3), exch = d.slice(3, 6), line = d.slice(6);
  if (!/[2-9]/.test(area[0]) || !/[2-9]/.test(exch[0])) return null;
  if (area[1] === "1" && area[2] === "1") return null; // N11
  if (exch === "555" && /^01\d\d$/.test(line)) return null; // fictional range
  if (/^(\d)\1{9}$/.test(d)) return null;
  return `(${area}) ${exch}-${line}`;
}

export const digitsOf = (phone) => String(phone || "").replace(/\D/g, "").slice(-10);

export function isHttpUrl(v) {
  try {
    const u = new URL(clean(v, 1000));
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".");
  } catch {
    return false;
  }
}

function cents(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= 100_000_000 ? n : null;
}

async function getJSON(store, key) {
  const v = await store.get(key, { type: "json" });
  return v ?? null;
}

async function listKeys(store, prefix) {
  const { blobs } = await store.list({ prefix });
  return blobs.map((b) => b.key);
}

async function loadAll(store, prefix) {
  const keys = (await listKeys(store, prefix)).slice(0, MAX_LIST * 4);
  const rows = await Promise.all(keys.map((k) => getJSON(store, k)));
  return rows.filter(Boolean);
}

export function fmtUsd(c) {
  const n = (Number(c) || 0) / 100;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: n % 1 ? 2 : 0 });
}

// ---------- bonds ----------

function emptyBond() {
  return { deposits: [], surety: null };
}

/** Bond money still standing behind a worker: unrefunded, unforfeited deposits plus any surety. */
export function bondCents(w) {
  const b = w?.bond;
  if (!b) return 0;
  const dep = (b.deposits || []).reduce((s, d) => s + d.cents - d.refunded_cents - d.forfeited_cents, 0);
  const sur = b.surety ? b.surety.cents - (b.surety.forfeited_cents || 0) : 0;
  return Math.max(0, dep + sur);
}

/** Takes up to `amount` out of the bond, deposits first (that money is CMF's to keep). Returns what was taken. */
function forfeitBond(w, amount) {
  if (!w.bond || amount <= 0) return { deposit: 0, surety: 0 };
  let left = amount, fromDeposit = 0, fromSurety = 0;
  for (const d of [...w.bond.deposits].reverse()) {
    const avail = d.cents - d.refunded_cents - d.forfeited_cents;
    const take = Math.min(avail, left);
    if (take > 0) { d.forfeited_cents += take; left -= take; fromDeposit += take; }
    if (!left) break;
  }
  if (left && w.bond.surety) {
    const avail = w.bond.surety.cents - (w.bond.surety.forfeited_cents || 0);
    const take = Math.min(avail, left);
    w.bond.surety.forfeited_cents = (w.bond.surety.forfeited_cents || 0) + take;
    fromSurety = take;
  }
  return { deposit: fromDeposit, surety: fromSurety };
}

/** Bond a worker must keep in place: open work plus verified tasks still inside the clawback window. */
async function lockedBond(store, workerId, now) {
  const tasks = await listTasks(store, {}, now);
  return tasks
    .filter(
      (t) =>
        t.claim?.worker_id === workerId &&
        (t.status === "claimed" || t.status === "submitted" || (t.status === "verified" && now - (t.verified_at || 0) < CLAWBACK_MS)),
    )
    .reduce((s, t) => s + (t.bond_cents || 0), 0);
}

/** Stripe Checkout finished: credit the deposit. Idempotent on the payment intent. */
export async function creditBondDeposit(store, workerId, { paymentIntent, cents: amount }, now = Date.now()) {
  const w = await getWorker(store, workerId);
  if (!w) return { error: "No such worker" };
  const c = cents(amount);
  if (!paymentIntent || !c) return { error: "Bad deposit" };
  w.bond = w.bond || emptyBond();
  if (w.bond.deposits.some((d) => d.pi === paymentIntent)) return { worker: w, duplicate: true };
  w.bond.deposits.push({ pi: paymentIntent, cents: c, refunded_cents: 0, forfeited_cents: 0, at: now });
  await store.setJSON(`worker/${w.id}`, w);
  return { worker: w };
}

/**
 * Credits bond payments by asking Stripe for completed Checkout sessions, so
 * bonds work with nothing but STRIPE_SECRET_KEY (the webhook is optional).
 * Looks back 48 hours every run; creditBondDeposit is idempotent per payment.
 */
export async function reconcileBonds(store, stripe, now = Date.now()) {
  if (!stripe) return 0;
  const { data = [] } = await stripe.recentCheckoutSessions(Math.floor((now - 48 * 3600 * 1000) / 1000));
  let credited = 0;
  for (const s of data) {
    if (s.metadata?.purpose !== "taskboard_bond" || s.payment_status !== "paid" || !s.payment_intent) continue;
    const out = await creditBondDeposit(store, s.metadata.worker_id, { paymentIntent: s.payment_intent, cents: s.amount_total }, now);
    if (out.worker && !out.duplicate) credited += 1;
  }
  return credited;
}

/** Admin: record a third-party surety bond (cents 0 clears it). */
export async function setSurety(store, workerId, body, now = Date.now()) {
  const w = await getWorker(store, workerId);
  if (!w) return { error: "No such worker" };
  const c = cents(body?.cents);
  if (c === null) return { error: "cents must be a whole number of cents" };
  const ref = clean(body?.ref, 120);
  if (c > 0 && !ref) return { error: "A surety bond needs ref (the bond number and surety company)" };
  w.bond = w.bond || emptyBond();
  w.bond.surety = c === 0 ? null : { cents: c, ref, forfeited_cents: 0, recorded_at: now };
  await store.setJSON(`worker/${w.id}`, w);
  return { worker: w };
}

/** Starts a Checkout session for the owner to post a bond. */
export async function startBondCheckout(store, worker, amountCents, stripe) {
  if (!stripe) return { error: "Bond payments are not switched on yet." };
  const c = cents(amountCents);
  if (!c || c < MIN_BOND_CENTS || c > MAX_BOND_CENTS) return { error: `amount_cents must be between ${MIN_BOND_CENTS} and ${MAX_BOND_CENTS}` };
  const site = siteUrl();
  const session = await stripe.bondCheckout({
    workerId: worker.id,
    cents: c,
    email: worker.owner_email,
    successUrl: `${site}/tasks?bond=posted`,
    cancelUrl: `${site}/tasks?bond=cancelled`,
  });
  return { checkout_url: session.url, amount_cents: c };
}

/** Refunds the bond deposit that no open or recently verified work depends on. */
export async function withdrawBond(store, worker, stripe, now = Date.now()) {
  if (!stripe) return { error: "Bond payments are not switched on yet." };
  if (worker.status !== "active") return { error: "A paused worker's bond can't be withdrawn. Contact CMF." };
  const w = await getWorker(store, worker.id);
  const locked = await lockedBond(store, w.id, now);
  const depositNet = (w.bond?.deposits || []).reduce((s, d) => s + d.cents - d.refunded_cents - d.forfeited_cents, 0);
  let free = Math.min(depositNet, bondCents(w) - locked);
  if (free <= 0) return { refunded_cents: 0, locked_cents: locked, note: "Nothing to withdraw: your bond backs open work or tasks verified in the last 30 days." };
  let refunded = 0;
  for (const d of [...w.bond.deposits].reverse()) {
    const avail = d.cents - d.refunded_cents - d.forfeited_cents;
    const amt = Math.min(avail, free);
    if (amt <= 0) continue;
    await stripe.refund({ paymentIntent: d.pi, amount: amt, idempotencyKey: `wd-${d.pi}-${d.refunded_cents}` });
    d.refunded_cents += amt;
    free -= amt;
    refunded += amt;
    await store.setJSON(`worker/${w.id}`, w);
    if (!free) break;
  }
  return { refunded_cents: refunded, locked_cents: locked, bond_cents: bondCents(w) };
}

// ---------- task types ----------

/**
 * Each type: what the poster gives (input), what the agent returns (result,
 * for docs and the MCP schema), a precheck run at submit time, and how it is
 * verified afterwards ("evidence" checks run by the cron; "event" waits for a
 * funding event from CMF's systems).
 */
export const TASK_TYPES = {
  carrier_phone: {
    label: "Carrier phone number",
    summary: "Find a working phone number for a trucking carrier by its USDOT number.",
    verify: "evidence",
    input: ["dot", "carrier_name", "state", "known_phones"],
    result: {
      phone: "10-digit US phone number that reaches the carrier",
      source_url: "Public web page that shows this number for this carrier (checked automatically)",
      contact_name: "Optional: who answers at that number",
      notes: "Optional: anything CMF should know",
    },
    validateInput(input) {
      const dot = clean(input.dot, 12).replace(/\D/g, "");
      if (!dot) return { error: "carrier_phone needs input.dot (USDOT number)" };
      const known = (Array.isArray(input.known_phones) ? input.known_phones : []).map(normPhone).filter(Boolean);
      return { input: { dot, carrier_name: clean(input.carrier_name, 160), state: clean(input.state, 2).toUpperCase(), known_phones: known } };
    },
    precheck(result, task) {
      const errors = [];
      const phone = normPhone(result.phone);
      if (!phone) errors.push("phone must be a real 10-digit US number");
      else if ((task.input.known_phones || []).includes(phone)) errors.push("CMF already has that number; find a different one");
      if (!isHttpUrl(result.source_url)) errors.push("source_url must be the http(s) link where you found the number");
      if (errors.length) return { ok: false, errors };
      return { ok: true, result: { phone, source_url: clean(result.source_url, 1000), contact_name: clean(result.contact_name, 120), notes: clean(result.notes, 1000) } };
    },
  },

  business_check: {
    label: "Business check",
    summary: "Confirm whether a business is operating, with links that show it.",
    verify: "evidence",
    input: ["business_name", "city", "state"],
    result: {
      operating: '"yes" or "no"',
      evidence_urls: "1 to 5 public links that show it (recent reviews, filings, listings); read automatically",
      notes: "Optional: anything CMF should know",
    },
    validateInput(input) {
      const business_name = clean(input.business_name, 160);
      if (!business_name) return { error: "business_check needs input.business_name" };
      return { input: { business_name, city: clean(input.city, 80), state: clean(input.state, 2).toUpperCase() } };
    },
    precheck(result) {
      const errors = [];
      const operating = clean(result.operating, 5).toLowerCase();
      if (operating !== "yes" && operating !== "no") errors.push('operating must be "yes" or "no"');
      const urls = Array.isArray(result.evidence_urls) ? result.evidence_urls : [];
      if (urls.length < 1 || urls.length > 5 || !urls.every(isHttpUrl)) errors.push("evidence_urls must be 1 to 5 http(s) links");
      if (errors.length) return { ok: false, errors };
      return { ok: true, result: { operating, evidence_urls: urls.map((u) => clean(u, 1000)), notes: clean(result.notes, 1000) } };
    },
  },

  deal_intro: {
    label: "Deal introduction",
    summary: "Introduce a business owner who needs capital and agreed to hear from CMF. Paid automatically when the deal funds.",
    verify: "event",
    input: ["desk", "criteria"],
    result: {
      business_name: "The business",
      contact_name: "The owner or decision-maker",
      phone: "Their 10-digit US phone number",
      email: "Their email",
      need: "What they need and why, at least 20 characters",
      contact_consented: "true: they agreed to be contacted by CMF",
    },
    validateInput(input) {
      const desk = clean(input.desk, 20);
      if (desk !== "trucking" && desk !== "hard_money") return { error: 'deal_intro needs input.desk "trucking" or "hard_money"' };
      return { input: { desk, criteria: clean(input.criteria, 1000) } };
    },
    precheck(result) {
      const errors = [];
      const phone = normPhone(result.phone);
      const email = clean(result.email, 200).toLowerCase();
      const need = clean(result.need, 2000);
      if (!clean(result.business_name, 160)) errors.push("business_name is required");
      if (!clean(result.contact_name, 120)) errors.push("contact_name is required");
      if (!phone) errors.push("phone must be a real 10-digit US number");
      if (!EMAIL_RE.test(email)) errors.push("email must be a valid email address");
      if (need.length < 20) errors.push("need must describe what they need in at least 20 characters");
      if (result.contact_consented !== true) errors.push("contact_consented must be true: only introduce people who agreed to hear from CMF");
      if (errors.length) return { ok: false, errors };
      return { ok: true, result: { business_name: clean(result.business_name, 160), contact_name: clean(result.contact_name, 120), phone, email, need, contact_consented: true } };
    },
  },
};

// ---------- views ----------

/** What anyone may see about a task: never the claimant, submissions or known numbers. */
export function publicTask(t) {
  const type = TASK_TYPES[t.type];
  const input = { ...t.input };
  delete input.known_phones;
  return {
    id: t.id,
    type: t.type,
    type_label: type?.label || t.type,
    title: t.title,
    instructions: t.instructions,
    input,
    result_format: type?.result || {},
    payout_cents: t.payout_cents,
    bond_cents: t.bond_cents,
    status: t.status,
    claim_expires_at: t.status === "claimed" && t.claim ? t.claim.expires_at : undefined,
    expires_at: t.expires_at || undefined,
    created_at: t.created_at,
  };
}

/** The claim holder's view: full input, plus where verification stands. */
function workerTask(t) {
  const last = t.submissions.at(-1);
  return {
    ...publicTask(t),
    input: t.input,
    verification: t.status === "submitted" ? t.auto : undefined,
    last_decision: last?.decision ? { decision: last.decision, note: last.note, at: last.decided_at } : undefined,
  };
}

export function publicWorker(w) {
  return {
    id: w.id,
    agent_name: w.agent_name,
    owner_name: w.owner_name,
    status: w.status,
    bond_cents: bondCents(w),
    payouts_ready: Boolean(w.payout?.ready),
    counts: w.counts,
    created_at: w.created_at,
  };
}

// ---------- reads with expiry applied ----------

async function expireClaim(store, t, now) {
  if (t && t.status === "claimed" && t.claim && t.claim.expires_at <= now) {
    t.status = "open";
    t.history.push({ at: now, event: "claim_expired", worker_id: t.claim.worker_id });
    t.claim = null;
    await store.setJSON(`task/${t.id}`, t);
  }
  if (t && t.status === "open" && t.expires_at && t.expires_at <= now) {
    t.status = "closed";
    t.history.push({ at: now, event: "task_expired" });
    await store.setJSON(`task/${t.id}`, t);
  }
  return t;
}

export async function getTask(store, id, now = Date.now()) {
  if (!/^t_[0-9a-f]{16}$/.test(String(id))) return null;
  return expireClaim(store, await getJSON(store, `task/${id}`), now);
}

export async function listTasks(store, { status, type } = {}, now = Date.now()) {
  const all = await loadAll(store, "task/");
  const fresh = await Promise.all(all.map((t) => expireClaim(store, t, now)));
  return fresh
    .filter((t) => (!status || t.status === status) && (!type || t.type === type))
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, MAX_LIST);
}

export async function boardStats(store, now = Date.now()) {
  const tasks = await listTasks(store, {}, now);
  const by = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const t of tasks) by[t.status] = (by[t.status] || 0) + 1;
  const ledger = await loadAll(store, "ledger/");
  const sum = (f) => ledger.filter(f).reduce((s, l) => s + l.cents, 0);
  return {
    tasks: by,
    workers: (await listKeys(store, "worker/")).length,
    paid_cents: sum((l) => l.kind === "payout" && l.status === "paid"),
    owed_cents: sum((l) => l.kind === "payout" && l.status === "owed"),
    forfeited_cents: sum((l) => l.kind === "forfeit"),
  };
}

// ---------- posting ----------

export function buildTask(spec, now = Date.now()) {
  const type = TASK_TYPES[spec?.type];
  if (!type) return { error: `type must be one of: ${Object.keys(TASK_TYPES).join(", ")}` };
  const title = clean(spec.title, 160);
  if (!title) return { error: "title is required" };
  const payout_cents = cents(spec.payout_cents);
  if (payout_cents === null || payout_cents < 1) return { error: "payout_cents must be a whole number of cents, at least 1" };
  const bond_cents = spec.bond_cents == null ? 0 : cents(spec.bond_cents);
  if (bond_cents === null) return { error: "bond_cents must be a whole number of cents" };
  const v = type.validateInput(spec.input || {});
  if (v.error) return { error: v.error };
  const max_attempts = Math.min(10, Math.max(1, Math.round(Number(spec.max_attempts)) || DEFAULT_MAX_ATTEMPTS));
  let expires_at = null;
  if (spec.expires_at) {
    const ts = Date.parse(spec.expires_at);
    if (!Number.isFinite(ts) || ts <= now) return { error: "expires_at must be a future date" };
    expires_at = ts;
  }
  return {
    task: {
      id: newId("t"),
      type: spec.type,
      title,
      instructions: clean(spec.instructions, 3000) || type.summary,
      input: v.input,
      payout_cents,
      bond_cents,
      max_attempts,
      attempts: 0,
      status: "open",
      claim: null,
      auto: null,
      submissions: [],
      history: [{ at: now, event: "posted" }],
      created_at: now,
      expires_at,
    },
  };
}

export async function postTasks(store, specs, now = Date.now()) {
  const built = specs.map((s) => buildTask(s, now));
  const bad = built.findIndex((b) => b.error);
  if (bad >= 0) return { error: `task ${bad + 1}: ${built[bad].error}` };
  for (const b of built) await store.setJSON(`task/${b.task.id}`, b.task);
  return { tasks: built.map((b) => b.task) };
}

export async function cancelTask(store, id, now = Date.now()) {
  const t = await getTask(store, id, now);
  if (!t) return { error: "No such task" };
  if (t.status === "verified") return { error: "A verified task can't be cancelled" };
  t.status = "cancelled";
  t.claim = null;
  t.auto = null;
  t.history.push({ at: now, event: "cancelled" });
  await store.setJSON(`task/${t.id}`, t);
  return { task: t };
}

// ---------- workers ----------

export async function registerWorker(store, body, now = Date.now()) {
  const agent_name = clean(body?.agent_name, 80);
  const owner_name = clean(body?.owner_name, 120);
  const owner_email = clean(body?.owner_email, 200).toLowerCase();
  if (!agent_name) return { error: "agent_name is required" };
  if (!owner_name) return { error: "owner_name is required: a person or business gets paid, not the agent" };
  if (!EMAIL_RE.test(owner_email)) return { error: "owner_email must be a valid email address" };
  const key = KEY_PREFIX + randomBytes(24).toString("base64url");
  const payoutToken = randomBytes(24).toString("base64url");
  const worker = {
    id: newId("w"),
    agent_name,
    owner_name,
    owner_email,
    status: "active",
    bond: emptyBond(),
    payout: { account: null, ready: false, checked_at: null },
    counts: { claimed: 0, submitted: 0, verified: 0, rejected: 0, fraud: 0 },
    created_at: now,
  };
  await store.setJSON(`worker/${worker.id}`, worker);
  await store.setJSON(`wkey/${hashKey(key)}`, { id: worker.id });
  await store.setJSON(`ptok/${hashKey(payoutToken)}`, { id: worker.id });
  return { worker, key, payoutToken, payoutUrl: payoutSetupUrl(payoutToken) };
}

export function payoutSetupUrl(token) {
  return `${siteUrl()}/api/tasks-payouts?t=${encodeURIComponent(token)}`;
}

/** A new payout-setup link for an authenticated worker (the old one keeps working too). */
export async function newPayoutLink(store, worker) {
  const token = randomBytes(24).toString("base64url");
  await store.setJSON(`ptok/${hashKey(token)}`, { id: worker.id });
  return payoutSetupUrl(token);
}

export async function workerForPayoutToken(store, token) {
  if (!TOKEN_RE.test(String(token || ""))) return null;
  const ref = await getJSON(store, `ptok/${hashKey(token)}`);
  return ref ? getWorker(store, ref.id) : null;
}

export async function workerForKey(store, key) {
  if (!KEY_RE.test(String(key || ""))) return null;
  const ref = await getJSON(store, `wkey/${hashKey(key)}`);
  return ref ? getJSON(store, `worker/${ref.id}`) : null;
}

export async function getWorker(store, id) {
  if (!/^w_[0-9a-f]{16}$/.test(String(id))) return null;
  return getJSON(store, `worker/${id}`);
}

export async function listWorkers(store) {
  return (await loadAll(store, "worker/")).sort((a, b) => b.created_at - a.created_at);
}

export async function setWorkerStatus(store, workerId, status) {
  const w = await getWorker(store, workerId);
  if (!w) return { error: "No such worker" };
  if (status !== "active" && status !== "paused") return { error: 'status must be "active" or "paused"' };
  w.status = status;
  await store.setJSON(`worker/${w.id}`, w);
  return { worker: w };
}

/**
 * Connects (or resumes) the owner's Stripe Express account and returns the
 * Stripe onboarding URL to send them to.
 */
export async function payoutOnboardingUrl(store, worker, token, stripe) {
  if (!stripe) return { error: "Payouts are not switched on yet." };
  const w = await getWorker(store, worker.id);
  if (!w.payout.account) {
    const acct = await stripe.createExpressAccount({ email: w.owner_email, workerId: w.id });
    w.payout.account = acct.id;
    await store.setJSON(`worker/${w.id}`, w);
  }
  const back = payoutSetupUrl(token);
  const link = await stripe.accountLink({ account: w.payout.account, refreshUrl: back, returnUrl: `${back}&done=1` });
  return { url: link.url };
}

/** Asks Stripe whether the owner's account can take transfers yet. */
export async function refreshPayoutStatus(store, worker, stripe, accountReady, now = Date.now()) {
  const w = await getWorker(store, worker.id);
  if (!stripe || !w.payout.account) return w;
  const acct = await stripe.getAccount(w.payout.account);
  w.payout.ready = accountReady(acct);
  w.payout.checked_at = now;
  await store.setJSON(`worker/${w.id}`, w);
  return w;
}

// ---------- the agent's side ----------

/** Tasks this worker holds right now (claimed or awaiting verification). */
async function heldBy(store, workerId, now) {
  const tasks = await listTasks(store, {}, now);
  return tasks.filter((t) => (t.status === "claimed" || t.status === "submitted") && t.claim?.worker_id === workerId);
}

export async function claimTask(store, worker, taskId, now = Date.now()) {
  if (worker.status !== "active") return { error: "This worker is paused. Contact CMF." };
  const t = await getTask(store, taskId, now);
  if (!t) return { error: "No such task" };
  if (t.status !== "open") return { error: `Task is ${t.status}, not open` };
  if (t.submissions.some((s) => s.worker_id === worker.id && s.decision)) {
    return { error: "You already had a submission decided on this task; another worker gets the next attempt" };
  }
  const held = await heldBy(store, worker.id, now);
  if (held.length >= MAX_ACTIVE_CLAIMS) return { error: `You already hold ${MAX_ACTIVE_CLAIMS} tasks. Submit or release one first.` };
  if (t.bond_cents > 0) {
    const onFile = bondCents(worker);
    const committed = await lockedBond(store, worker.id, now);
    if (onFile - committed < t.bond_cents) {
      return {
        error: `This task requires a bond of ${fmtUsd(t.bond_cents)}. You have ${fmtUsd(onFile)} on file and ${fmtUsd(committed)} committed to open or recently verified work. Post more with post_bond.`,
      };
    }
  }
  t.status = "claimed";
  t.claim = { worker_id: worker.id, at: now, expires_at: now + CLAIM_MS };
  t.history.push({ at: now, event: "claimed", worker_id: worker.id });
  await store.setJSON(`task/${t.id}`, t);
  worker.counts.claimed += 1;
  await store.setJSON(`worker/${worker.id}`, worker);
  return { task: workerTask(t) };
}

export async function releaseTask(store, worker, taskId, now = Date.now()) {
  const t = await getTask(store, taskId, now);
  if (!t) return { error: "No such task" };
  if (t.status !== "claimed" || t.claim?.worker_id !== worker.id) return { error: "You don't hold a claim on this task" };
  t.status = "open";
  t.claim = null;
  t.history.push({ at: now, event: "released", worker_id: worker.id });
  await store.setJSON(`task/${t.id}`, t);
  return { task: publicTask(t) };
}

/**
 * Runs the type's precheck. A failed precheck keeps the claim so the agent
 * can fix it and resubmit. A passed one queues automatic verification.
 */
export async function submitResult(store, worker, taskId, result, now = Date.now()) {
  if (worker.status !== "active") return { error: "This worker is paused. Contact CMF." };
  const t = await getTask(store, taskId, now);
  if (!t) return { error: "No such task" };
  if (t.status !== "claimed" || t.claim?.worker_id !== worker.id) {
    return { error: "You don't hold a live claim on this task. Claim it first (claims last 2 hours)." };
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) return { error: "result must be an object" };
  if (JSON.stringify(result).length > 8000) return { error: "result is too large" };
  const type = TASK_TYPES[t.type];
  const check = type.precheck(result, t);
  if (!check.ok) return { precheck: "failed", errors: check.errors, claim_expires_at: t.claim.expires_at };
  t.status = "submitted";
  t.auto = type.verify === "event"
    ? { state: "waiting_event", tries: 0, note: "Paid automatically when the deal funds", at: now }
    : { state: "pending", tries: 0, note: "Queued for automatic verification", at: now };
  t.submissions.push({ worker_id: worker.id, at: now, result: check.result, decision: null });
  t.history.push({ at: now, event: "submitted", worker_id: worker.id });
  await store.setJSON(`task/${t.id}`, t);
  worker.counts.submitted += 1;
  await store.setJSON(`worker/${worker.id}`, worker);
  return { precheck: "passed", status: "submitted", verification: t.auto, task: publicTask(t) };
}

export async function workerAccount(store, worker, now = Date.now()) {
  const held = await heldBy(store, worker.id, now);
  const ledger = (await loadAll(store, "ledger/")).filter((l) => l.worker_id === worker.id);
  const sum = (f) => ledger.filter(f).reduce((s, l) => s + l.cents, 0);
  const locked = await lockedBond(store, worker.id, now);
  return {
    worker: publicWorker(worker),
    holding: held.map(workerTask),
    payouts: { ready: Boolean(worker.payout?.ready), connected: Boolean(worker.payout?.account) },
    bond: { on_file_cents: bondCents(worker), locked_cents: locked, free_cents: Math.max(0, bondCents(worker) - locked) },
    earnings: {
      owed_cents: sum((l) => l.kind === "payout" && l.status === "owed"),
      paid_cents: sum((l) => l.kind === "payout" && l.status === "paid"),
      forfeited_cents: sum((l) => l.kind === "forfeit"),
    },
    ledger: ledger.sort((a, b) => b.created_at - a.created_at).slice(0, 50),
  };
}

// ---------- decisions (automatic, by event, or CMF's override) ----------

/**
 * decision: "verify" | "reject" (an honest miss) | "fraud" (forfeits the
 * task's bond and pauses the worker). by: "auto" | "event" | "admin".
 */
export async function decide(store, taskId, decision, note, now = Date.now(), by = "admin") {
  if (!["verify", "reject", "fraud"].includes(decision)) return { error: 'decision must be "verify", "reject" or "fraud"' };
  const t = await getTask(store, taskId, now);
  if (!t) return { error: "No such task" };
  if (t.status !== "submitted") return { error: `Task is ${t.status}; only a submitted task can be decided` };
  const sub = t.submissions.at(-1);
  const w = await getWorker(store, sub.worker_id);
  sub.decision = decision;
  sub.decided_at = now;
  sub.decided_by = by;
  sub.note = clean(note, 1000);
  t.auto = null;
  const out = { task: t, worker: w, ledger: [] };

  if (decision === "verify") {
    t.status = "verified";
    t.verified_at = now;
    const entry = { id: newId("l"), kind: "payout", worker_id: sub.worker_id, task_id: t.id, cents: t.payout_cents, status: "owed", tries: 0, created_at: now };
    await store.setJSON(`ledger/${entry.id}`, entry);
    out.ledger.push(entry);
    if (w) w.counts.verified += 1;
  } else {
    t.attempts += 1;
    t.status = t.attempts >= t.max_attempts ? "closed" : "open";
    t.claim = null;
    if (w) w.counts[decision === "fraud" ? "fraud" : "rejected"] += 1;
    if (decision === "fraud" && w) out.ledger.push(...(await penalize(store, w, t, sub.note, now)));
  }
  t.history.push({ at: now, event: decision, by, worker_id: sub.worker_id });
  await store.setJSON(`task/${t.id}`, t);
  if (w) await store.setJSON(`worker/${w.id}`, w);
  return out;
}

/** Forfeits the task's bond and pauses the worker. Caller saves the worker. */
async function penalize(store, w, t, note, now) {
  const take = forfeitBond(w, t.bond_cents || 0);
  w.status = "paused";
  const total = take.deposit + take.surety;
  if (!total) return [];
  const entry = {
    id: newId("l"), kind: "forfeit", worker_id: w.id, task_id: t.id, cents: total,
    from_deposit_cents: take.deposit, from_surety_cents: take.surety, status: "forfeited", note, created_at: now,
  };
  await store.setJSON(`ledger/${entry.id}`, entry);
  return [entry];
}

/** Puts the automatic verifier's progress on a submitted task. */
export async function setAuto(store, taskId, patch, now = Date.now()) {
  const t = await getTask(store, taskId, now);
  if (!t || t.status !== "submitted") return null;
  t.auto = { ...(t.auto || {}), ...patch, at: now };
  await store.setJSON(`task/${t.id}`, t);
  return t;
}

/** Submitted tasks the cron should verify now. */
export async function pendingVerification(store, now = Date.now()) {
  return (await listTasks(store, { status: "submitted" }, now)).filter((t) => t.auto?.state === "pending");
}

/** CMF's systems report a funded deal: pays the intro automatically. */
export async function dealFunded(store, taskId, now = Date.now()) {
  const t = await getTask(store, taskId, now);
  if (!t || t.type !== "deal_intro") return { error: "No such deal intro" };
  if (t.status !== "submitted") return { error: `Task is ${t.status}` };
  return decide(store, t.id, "verify", "Deal funded", now, "event");
}

/** Deal intros that never funded inside the window are closed out as misses. */
export async function expireDealIntros(store, now = Date.now()) {
  const waiting = (await listTasks(store, { status: "submitted", type: "deal_intro" }, now)).filter(
    (t) => t.auto?.state === "waiting_event" && now - t.submissions.at(-1).at > DEAL_WINDOW_MS,
  );
  for (const t of waiting) await decide(store, t.id, "reject", "Did not fund within 90 days", now, "auto");
  return waiting.length;
}

/**
 * A CMF call proved a paid phone number wrong. Every carrier_phone task
 * verified with that number inside the clawback window is clawed back: bond
 * forfeited, unpaid payout cancelled, worker paused, task reopened.
 */
export async function reportWrongNumber(store, phone, reason, now = Date.now()) {
  const p = normPhone(phone);
  if (!p) return { error: "phone must be a 10-digit US number" };
  const hits = (await listTasks(store, { status: "verified", type: "carrier_phone" }, now)).filter(
    (t) => now - (t.verified_at || 0) < CLAWBACK_MS && t.submissions.at(-1)?.result?.phone === p,
  );
  const out = [];
  for (const t of hits) {
    const sub = t.submissions.at(-1);
    const w = await getWorker(store, sub.worker_id);
    const ledger = (await loadAll(store, "ledger/")).filter((l) => l.task_id === t.id && l.kind === "payout" && l.status === "owed");
    for (const l of ledger) {
      l.status = "cancelled";
      l.note = "Clawed back: number proved wrong";
      await store.setJSON(`ledger/${l.id}`, l);
    }
    const forfeits = w ? await penalize(store, w, t, clean(reason, 300), now) : [];
    if (w) {
      w.counts.fraud += 1;
      await store.setJSON(`worker/${w.id}`, w);
    }
    sub.decision = "fraud";
    sub.note = `Clawed back: ${clean(reason, 300)}`;
    t.attempts += 1;
    t.status = t.attempts >= t.max_attempts ? "closed" : "open";
    t.claim = null;
    t.input.known_phones = [...new Set([...(t.input.known_phones || []), p])];
    t.history.push({ at: now, event: "clawed_back", worker_id: sub.worker_id });
    await store.setJSON(`task/${t.id}`, t);
    out.push({ task_id: t.id, worker_id: sub.worker_id, cancelled_payouts: ledger.length, forfeited_cents: forfeits.reduce((s, f) => s + f.cents, 0) });
  }
  return { clawed_back: out };
}

// ---------- payouts ----------

export async function listLedger(store) {
  return (await loadAll(store, "ledger/")).sort((a, b) => b.created_at - a.created_at);
}

/** When a failed payout may be tried again. */
export function nextPayoutTry(err, tries, now) {
  const msg = String(err?.message || err);
  const funds = err?.code === "balance_insufficient" || /insufficient funds/i.test(msg);
  return now + (funds ? PAYOUT_RETRY_FUNDS_MS : Math.min(PAYOUT_RETRY_MAX_MS, 2 ** tries * 60 * 1000));
}

/**
 * Sends every owed payout whose owner can take transfers. Checks owners who
 * aren't ready yet with Stripe (at most every 10 minutes), and leaves a payout
 * that failed alone until its next_try_at. Safe to rerun: the ledger id is the
 * transfer's idempotency key.
 */
export async function processPayouts(store, stripe, accountReady, now = Date.now()) {
  if (!stripe) return { skipped: "no Stripe key" };
  const owed = (await listLedger(store)).filter((l) => l.kind === "payout" && l.status === "owed");
  const result = { paid: 0, waiting_setup: 0, failed: 0, backing_off: 0 };
  const workers = new Map();
  for (const l of owed) {
    let w = workers.get(l.worker_id) || (await getWorker(store, l.worker_id));
    if (!w) continue;
    if (w.payout?.account && !w.payout.ready && now - (w.payout.checked_at || 0) > 10 * 60 * 1000) {
      w = await refreshPayoutStatus(store, w, stripe, accountReady, now);
    }
    workers.set(w.id, w);
    if (!w.payout?.ready) {
      if (l.waiting !== "payout_setup") {
        l.waiting = "payout_setup";
        await store.setJSON(`ledger/${l.id}`, l);
      }
      result.waiting_setup += 1;
      continue;
    }
    if (l.next_try_at && l.next_try_at > now) {
      result.backing_off += 1;
      continue;
    }
    delete l.waiting; // the owner is set up now
    try {
      const tr = await stripe.transfer({ amount: l.cents, destination: w.payout.account, taskId: l.task_id, ledgerId: l.id });
      l.status = "paid";
      l.paid_at = now;
      l.transfer_id = tr.id;
      delete l.error;
      delete l.next_try_at;
      result.paid += 1;
    } catch (err) {
      l.tries = (l.tries || 0) + 1;
      l.error = String(err?.message || err).slice(0, 300);
      l.next_try_at = nextPayoutTry(err, l.tries, now);
      result.failed += 1;
    }
    await store.setJSON(`ledger/${l.id}`, l);
  }
  return result;
}

/** Admin override: record a payout made outside Stripe. */
export async function markPaid(store, ledgerId, ref, now = Date.now()) {
  if (!/^l_[0-9a-f]{16}$/.test(String(ledgerId))) return { error: "No such ledger entry" };
  const e = await getJSON(store, `ledger/${ledgerId}`);
  if (!e) return { error: "No such ledger entry" };
  if (e.kind !== "payout") return { error: "Only payouts can be marked paid" };
  if (e.status !== "owed") return { error: `Payout is ${e.status}` };
  e.status = "paid";
  e.paid_at = now;
  e.paid_ref = clean(ref, 200);
  await store.setJSON(`ledger/${e.id}`, e);
  return { entry: e };
}

// ---------- alerts ----------

export function submissionAlert(task, worker) {
  const lines = [
    `🧾 Task Board: ${task.type === "deal_intro" ? "new deal intro" : "submission (verifying automatically)"}`,
    `${task.title} (${TASK_TYPES[task.type]?.label || task.type})`,
    `Payout ${fmtUsd(task.payout_cents)}${task.bond_cents ? `, bond ${fmtUsd(task.bond_cents)}` : ""}`,
    `From ${worker.agent_name} (owner: ${worker.owner_name})`,
  ];
  if (task.type === "deal_intro") {
    const r = task.submissions.at(-1).result;
    lines.push("", `${r.business_name}: ${r.contact_name}`, `${r.phone} · ${r.email}`, r.need, "", `Pays when funded: POST /api/tasks-events {"type":"deal_funded","task_id":"${task.id}"}`);
  }
  return lines.join("\n");
}

export function registrationAlert(worker) {
  return `🤖 Task Board: new agent registered\n${worker.agent_name}\nOwner: ${worker.owner_name} <${worker.owner_email}>`;
}

/** Telegram, best effort. Same env as the other site alerts. */
export async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TASKS_TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) console.error("taskboard telegram failed:", res.status);
  } catch (err) {
    console.error("taskboard telegram failed:", err?.message);
  }
}

/** Emails the owner their payout-setup link (Resend, best effort). */
export async function sendPayoutSetupEmail(worker, url) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return;
  const from = process.env.TASKS_FROM_EMAIL || "CMF Task Board <no-reply@crownmerchantfinancial.com>";
  const text = [
    `Hi ${worker.owner_name},`,
    "",
    `Your agent "${worker.agent_name}" is registered on the CMF Task Board.`,
    "To get paid for verified tasks, connect a payout account through Stripe:",
    url,
    "",
    "Payouts are sent automatically once a task is verified and your account is set up.",
    "",
    "Crown Merchant Financial",
  ].join("\n");
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [worker.owner_email], subject: "Set up payouts for your CMF Task Board agent", text }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) console.error("taskboard payout email failed:", res.status);
  } catch (err) {
    console.error("taskboard payout email failed:", err?.message);
  }
}
