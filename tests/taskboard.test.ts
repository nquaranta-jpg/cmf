import { describe, it, expect, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  postTasks,
  registerWorker,
  workerForKey,
  claimTask,
  releaseTask,
  submitResult,
  decide,
  setSurety,
  creditBondDeposit,
  withdrawBond,
  bondCents,
  processPayouts,
  reportWrongNumber,
  dealFunded,
  expireDealIntros,
  pendingVerification,
  workerForPayoutToken,
  markPaid,
  CLAWBACK_MS,
  DEAL_WINDOW_MS,
  PAYOUT_RETRY_FUNDS_MS,
  PAYOUT_RETRY_MAX_MS,
  nextPayoutTry,
  getTask,
  getWorker,
  listTasks,
  workerAccount,
  boardStats,
  publicTask,
  normPhone,
  CLAIM_MS,
  MAX_ACTIVE_CLAIMS,
  type TaskStore,
  type Task,
  type Worker,
} from "../netlify/functions/lib/taskboard.mjs";
import { createTaskServer } from "../src/tasks/server.js";
import { verifySubmission, phonesOnPage, fetchPage, type VerifyDeps } from "../src/tasks/verify.js";
import { runTaskBoardJobs } from "../src/tasks/jobs.js";
import { formEncode, verifyStripeWebhook, accountReady } from "../netlify/functions/lib/stripe.mjs";
import { createHmac } from "node:crypto";

/** In-memory stand-in for a Netlify Blobs store (JSON round-trip like the real one). */
function memStore(): TaskStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async get(key) {
      const v = data.get(key);
      return v === undefined ? null : JSON.parse(v);
    },
    async setJSON(key, value) {
      data.set(key, JSON.stringify(value));
    },
    async delete(key) {
      data.delete(key);
    },
    async list({ prefix }) {
      return { blobs: [...data.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) };
    },
  };
}

const T0 = Date.UTC(2026, 10, 26, 15, 0, 0);
const HOUR = 3_600_000;

const phoneTask = (over: Record<string, unknown> = {}) => ({
  type: "carrier_phone",
  title: "Phone for DOT 1234567",
  input: { dot: "1234567", carrier_name: "Acme Hauling LLC", state: "il", known_phones: ["312-203-8106"] },
  payout_cents: 500,
  ...over,
});

const goodPhone = { phone: "(708) 555-2210", source_url: "https://example.com/acme" };

let store: ReturnType<typeof memStore>;

async function post(spec = phoneTask()): Promise<Task> {
  const out = await postTasks(store, [spec], T0);
  if ("error" in out) throw new Error(out.error);
  return out.tasks[0];
}

async function worker(name = "Hermes"): Promise<{ w: Worker; key: string }> {
  const out = await registerWorker(store, { agent_name: name, owner_name: "Test Owner", owner_email: "owner@example.com" }, T0);
  if ("error" in out) throw new Error(out.error);
  return { w: out.worker, key: out.key };
}

const fresh = async (id: string) => (await getWorker(store, id))!;

beforeEach(() => {
  store = memStore();
});

describe("posting", () => {
  it("validates type, payout and input", async () => {
    expect(await postTasks(store, [{ type: "nope", title: "x", payout_cents: 1 }], T0)).toEqual({ error: expect.stringContaining("type must be") });
    expect(await postTasks(store, [phoneTask({ payout_cents: 0 })], T0)).toEqual({ error: expect.stringContaining("payout_cents") });
    expect(await postTasks(store, [phoneTask({ input: {} })], T0)).toEqual({ error: expect.stringContaining("input.dot") });
    expect(await postTasks(store, [{ type: "deal_intro", title: "x", payout_cents: 1, input: { desk: "life" } }], T0)).toEqual({
      error: expect.stringContaining("desk"),
    });
  });

  it("normalizes input and hides known numbers from the public view", async () => {
    const t = await post();
    expect(t.input.state).toBe("IL");
    expect(t.input.known_phones).toEqual(["(312) 203-8106"]);
    expect(publicTask(t).input.known_phones).toBeUndefined();
    expect(t.status).toBe("open");
  });
});

describe("workers", () => {
  it("needs an owner and stores only a hash of the key", async () => {
    expect(await registerWorker(store, { agent_name: "a", owner_name: "", owner_email: "a@b.co" }, T0)).toEqual({ error: expect.stringContaining("owner_name") });
    const { w, key } = await worker();
    expect(key).toMatch(/^cmfw_/);
    expect([...store.data.values()].some((v) => v.includes(key))).toBe(false);
    expect((await workerForKey(store, key))?.id).toBe(w.id);
    expect(await workerForKey(store, "cmfw_" + "x".repeat(32))).toBeNull();
  });
});

describe("claim, submit, verify, pay", () => {
  it("runs the whole loop and writes an owed payout", async () => {
    const t = await post();
    const { w } = await worker();
    const c = await claimTask(store, w, t.id, T0);
    expect("task" in c && c.task.input.known_phones).toEqual(["(312) 203-8106"]);

    const s = await submitResult(store, await fresh(w.id), t.id, goodPhone, T0 + 1000);
    expect(s).toMatchObject({ precheck: "passed", status: "submitted" });

    const d = await decide(store, t.id, "verify", "dialed, reached dispatch", T0 + HOUR);
    expect("ledger" in d && d.ledger).toEqual([expect.objectContaining({ kind: "payout", cents: 500, status: "owed" })]);

    const acct = await workerAccount(store, await fresh(w.id), T0 + HOUR);
    expect(acct.earnings).toEqual({ owed_cents: 500, paid_cents: 0, forfeited_cents: 0, coverage_fees_cents: 0 });

    const ledgerId = ("ledger" in d && d.ledger[0].id) as string;
    expect(await markPaid(store, ledgerId, "Zelle 11/27", T0 + 2 * HOUR)).toMatchObject({ entry: { status: "paid" } });
    expect(await markPaid(store, ledgerId, "", T0 + 2 * HOUR)).toEqual({ error: "Payout is paid" });
    expect((await boardStats(store, T0 + 2 * HOUR)).paid_cents).toBe(500);
  });

  it("precheck failures keep the claim and explain what's wrong", async () => {
    const t = await post();
    const { w } = await worker();
    await claimTask(store, w, t.id, T0);
    const s = await submitResult(store, w, t.id, { phone: "312-203-8106", source_url: "not a url" }, T0);
    expect(s).toMatchObject({ precheck: "failed" });
    expect("errors" in s && s.errors.join(" ")).toMatch(/already has that number.*source_url/);
    expect((await getTask(store, t.id, T0))!.status).toBe("claimed");
  });

  it("only the current claim holder can submit", async () => {
    const t = await post();
    const a = await worker("A");
    const b = await worker("B");
    await claimTask(store, a.w, t.id, T0);
    expect(await claimTask(store, b.w, t.id, T0)).toEqual({ error: "Task is claimed, not open" });
    expect(await submitResult(store, b.w, t.id, goodPhone, T0)).toEqual({ error: expect.stringContaining("don't hold a live claim") });
  });

  it("claims expire and the task reopens", async () => {
    const t = await post();
    const { w } = await worker();
    await claimTask(store, w, t.id, T0);
    expect((await getTask(store, t.id, T0 + CLAIM_MS + 1))!.status).toBe("open");
    expect(await submitResult(store, w, t.id, goodPhone, T0 + CLAIM_MS + 1)).toEqual({ error: expect.stringContaining("live claim") });
  });

  it("caps how many tasks one worker holds", async () => {
    const { w } = await worker();
    for (let i = 0; i < MAX_ACTIVE_CLAIMS; i++) {
      const t = await post(phoneTask({ title: `t${i}` }));
      await claimTask(store, await fresh(w.id), t.id, T0);
    }
    const extra = await post(phoneTask({ title: "extra" }));
    expect(await claimTask(store, await fresh(w.id), extra.id, T0)).toEqual({ error: expect.stringContaining("already hold") });
  });

  it("release puts the task back", async () => {
    const t = await post();
    const { w } = await worker();
    await claimTask(store, w, t.id, T0);
    await releaseTask(store, w, t.id, T0);
    expect((await listTasks(store, { status: "open" }, T0)).map((x) => x.id)).toEqual([t.id]);
  });
});

describe("reject and attempts", () => {
  it("an honest miss reopens the task, the same worker can't retry, and it closes after max attempts", async () => {
    const t = await post(phoneTask({ max_attempts: 2 }));
    const a = await worker("A");
    const b = await worker("B");
    await claimTask(store, a.w, t.id, T0);
    await submitResult(store, await fresh(a.w.id), t.id, goodPhone, T0);
    await decide(store, t.id, "reject", "disconnected", T0);
    expect((await getTask(store, t.id, T0))!.status).toBe("open");
    expect(await claimTask(store, await fresh(a.w.id), t.id, T0)).toEqual({ error: expect.stringContaining("another worker") });
    expect((await fresh(a.w.id)).status).toBe("active");

    await claimTask(store, b.w, t.id, T0);
    await submitResult(store, await fresh(b.w.id), t.id, { ...goodPhone, phone: "708-555-3301" }, T0);
    await decide(store, t.id, "reject", "wrong company", T0);
    expect((await getTask(store, t.id, T0))!.status).toBe("closed");
  });
});

/** A fake Stripe that records calls. */
function fakeStripe(opts: { ready?: boolean; failTransfer?: boolean } = {}) {
  const calls: { op: string; args: any }[] = [];
  return {
    calls,
    testMode: true,
    async createExpressAccount(args: any) { calls.push({ op: "account", args }); return { id: "acct_test1" }; },
    async accountLink(args: any) { calls.push({ op: "link", args }); return { url: "https://connect.stripe.com/setup/x" }; },
    async getAccount(id: string) { calls.push({ op: "get", args: id }); return { id, payouts_enabled: true, capabilities: { transfers: opts.ready === false ? "inactive" : "active" } }; },
    async transfer(args: any) { calls.push({ op: "transfer", args }); if (opts.failTransfer) throw new Error("Insufficient funds"); return { id: "tr_" + args.ledgerId }; },
    madeTransfers: [] as any[],
    async findTransfer(args: any) { calls.push({ op: "find", args }); return this.madeTransfers.find((t: any) => t.metadata.ledger_id === args.ledgerId) || null; },
    async bondCheckout(args: any) { calls.push({ op: "checkout", args }); return { id: "cs_1", url: "https://checkout.stripe.com/c/x" }; },
    async refund(args: any) { calls.push({ op: "refund", args }); return { id: "re_1" }; },
    sessions: [] as any[],
    async recentCheckoutSessions(since: number) { calls.push({ op: "sessions", args: since }); return { data: this.sessions }; },
  };
}

async function readyWorker(name = "Hermes") {
  const { w, key } = await worker(name);
  const fresh1 = await fresh(w.id);
  fresh1.payout = { account: "acct_test1", ready: true, checked_at: T0 };
  await store.setJSON(`worker/${w.id}`, fresh1);
  return { w: fresh1, key };
}

describe("bonds", () => {
  it("a bonded task needs a bond on file that covers all open work", async () => {
    const t1 = await post(phoneTask({ title: "bonded 1", bond_cents: 2000 }));
    const t2 = await post(phoneTask({ title: "bonded 2", bond_cents: 2000 }));
    const { w } = await worker();
    expect(await claimTask(store, w, t1.id, T0)).toEqual({ error: expect.stringContaining("requires a bond of $20") });

    expect(await setSurety(store, w.id, { cents: 3000 }, T0)).toEqual({ error: expect.stringContaining("bond number") });
    await setSurety(store, w.id, { cents: 3000, ref: "Bond #S-100, Example Surety" }, T0);
    expect(bondCents(await fresh(w.id))).toBe(3000);
    expect(await claimTask(store, await fresh(w.id), t1.id, T0)).toHaveProperty("task");
    expect(await claimTask(store, await fresh(w.id), t2.id, T0)).toEqual({ error: expect.stringContaining("$20 committed") });
  });

  it("Checkout deposits are credited once per payment", async () => {
    const { w } = await worker();
    await creditBondDeposit(store, w.id, { paymentIntent: "pi_1", cents: 5000 }, T0);
    const again = await creditBondDeposit(store, w.id, { paymentIntent: "pi_1", cents: 5000 }, T0);
    expect(again).toMatchObject({ duplicate: true });
    expect(bondCents(await fresh(w.id))).toBe(5000);
  });

  it("fraud forfeits the task's bond, deposit first, and pauses the worker", async () => {
    const t = await post(phoneTask({ bond_cents: 2000 }));
    const { w } = await worker();
    await creditBondDeposit(store, w.id, { paymentIntent: "pi_1", cents: 5000 }, T0);
    await claimTask(store, await fresh(w.id), t.id, T0);
    await submitResult(store, await fresh(w.id), t.id, goodPhone, T0);
    const d = await decide(store, t.id, "fraud", "number never existed", T0);
    expect("ledger" in d && d.ledger).toEqual([expect.objectContaining({ kind: "forfeit", cents: 2000, from_deposit_cents: 2000 })]);
    const after = await fresh(w.id);
    expect(after.status).toBe("paused");
    expect(bondCents(after)).toBe(3000);
    expect((await getTask(store, t.id, T0))!.status).toBe("open");
  });

  it("withdraw refunds only bond no open or recent work depends on", async () => {
    const stripe = fakeStripe();
    const t = await post(phoneTask({ bond_cents: 2000 }));
    const { w } = await worker();
    await creditBondDeposit(store, w.id, { paymentIntent: "pi_1", cents: 5000 }, T0);
    await claimTask(store, await fresh(w.id), t.id, T0);
    const out = await withdrawBond(store, await fresh(w.id), stripe, T0);
    expect(out).toMatchObject({ refunded_cents: 3000, locked_cents: 2000 });
    expect(stripe.calls.filter((c) => c.op === "refund").map((c) => c.args)).toEqual([expect.objectContaining({ paymentIntent: "pi_1", amount: 3000 })]);
    expect(bondCents(await fresh(w.id))).toBe(2000);

    // Verified work keeps its bond locked for the clawback window, then frees it.
    await submitResult(store, await fresh(w.id), t.id, goodPhone, T0);
    await decide(store, t.id, "verify", "", T0, "auto");
    expect(await withdrawBond(store, await fresh(w.id), stripe, T0 + 1000)).toMatchObject({ refunded_cents: 0 });
    expect(await withdrawBond(store, await fresh(w.id), stripe, T0 + CLAWBACK_MS + 1)).toMatchObject({ refunded_cents: 2000 });
  });

  it("the job credits paid bond sessions from Stripe, once, and ignores other checkouts", async () => {
    const { w } = await worker();
    const stripe = fakeStripe();
    stripe.sessions = [
      { metadata: { purpose: "taskboard_bond", worker_id: w.id }, payment_status: "paid", payment_intent: "pi_9", amount_total: 2500 },
      { metadata: { purpose: "taskboard_bond", worker_id: w.id }, payment_status: "unpaid", payment_intent: "pi_8", amount_total: 2500 },
      { metadata: { purpose: "lead_store" }, payment_status: "paid", payment_intent: "pi_7", amount_total: 9900 },
    ];
    const run = () => runTaskBoardJobs({ store, stripe, accountReady, verify: async () => ({ decision: "review", note: "" }), now: () => T0, notify: () => undefined });
    expect(await run()).toMatchObject({ bonds_credited: 1 });
    expect(await run()).toMatchObject({ bonds_credited: 0 });
    expect(bondCents(await fresh(w.id))).toBe(2500);
  });

  it("post_bond starts a Checkout for the owner", async () => {
    const stripe = fakeStripe();
    const { w } = await worker();
    const { startBondCheckout } = await import("../netlify/functions/lib/taskboard.mjs");
    expect(await startBondCheckout(store, w, 100, stripe)).toEqual({ error: expect.stringContaining("between") });
    expect(await startBondCheckout(store, w, 5000, stripe)).toEqual({ checkout_url: "https://checkout.stripe.com/c/x", amount_cents: 5000 });
    expect(stripe.calls[0].args).toMatchObject({ workerId: w.id, cents: 5000, email: "owner@example.com" });
  });
});

describe("payouts", () => {
  async function verifiedFor(key: { w: Worker }) {
    const t = await post();
    await claimTask(store, key.w, t.id, T0);
    await submitResult(store, await fresh(key.w.id), t.id, goodPhone, T0);
    await decide(store, t.id, "verify", "", T0, "auto");
    return t;
  }

  it("sends owed payouts to ready owners, idempotently by ledger id", async () => {
    const stripe = fakeStripe();
    const r = await readyWorker();
    const t = await verifiedFor(r);
    expect(await processPayouts(store, stripe, accountReady, T0)).toMatchObject({ paid: 1 });
    const tr = stripe.calls.find((c) => c.op === "transfer")!.args;
    expect(tr).toMatchObject({ amount: 500, destination: "acct_test1", taskId: t.id });
    expect(tr.ledgerId).toMatch(/^l_/);
    expect(await processPayouts(store, stripe, accountReady, T0)).toMatchObject({ paid: 0 });
    expect((await workerAccount(store, await fresh(r.w.id), T0)).earnings.paid_cents).toBe(500);
  });

  it("holds payouts until the owner finishes Stripe onboarding, then sends them", async () => {
    const { w } = await worker();
    await verifiedFor({ w });
    const stripe = fakeStripe();
    expect(await processPayouts(store, stripe, accountReady, T0)).toMatchObject({ paid: 0, waiting_setup: 1 });
    const acct = await fresh(w.id);
    acct.payout.account = "acct_test1";
    await store.setJSON(`worker/${w.id}`, acct);
    expect(await processPayouts(store, stripe, accountReady, T0 + 11 * 60 * 1000)).toMatchObject({ paid: 1 });
  });

  it("a payout refused for low balance waits an hour, then goes out", async () => {
    const r = await readyWorker();
    await verifiedFor(r);
    expect(await processPayouts(store, fakeStripe({ failTransfer: true }), accountReady, T0)).toMatchObject({ failed: 1 });
    // Every 2-minute run inside the hour leaves it alone: no call to Stripe.
    const quiet = fakeStripe();
    expect(await processPayouts(store, quiet, accountReady, T0 + 2 * 60 * 1000)).toMatchObject({ backing_off: 1, paid: 0 });
    expect(quiet.calls.filter((c) => c.op === "transfer")).toHaveLength(0);
    expect(await processPayouts(store, fakeStripe(), accountReady, T0 + PAYOUT_RETRY_FUNDS_MS)).toMatchObject({ paid: 1 });
  });

  it("each retry uses a fresh Stripe key and never pays twice", async () => {
    const r = await readyWorker();
    await verifiedFor(r);
    expect(await processPayouts(store, fakeStripe({ failTransfer: true }), accountReady, T0)).toMatchObject({ failed: 1 });
    // The first retry finds that an earlier attempt actually went through: no new transfer.
    const stripe = fakeStripe();
    const ledgerId = (await workerAccount(store, await fresh(r.w.id), T0)).ledger[0].id;
    stripe.madeTransfers.push({ id: "tr_earlier", metadata: { ledger_id: ledgerId } });
    expect(await processPayouts(store, stripe, accountReady, T0 + PAYOUT_RETRY_FUNDS_MS)).toMatchObject({ paid: 1 });
    expect(stripe.calls.filter((c) => c.op === "transfer")).toHaveLength(0);
    const l = (await workerAccount(store, await fresh(r.w.id), T0)).ledger[0];
    expect(l).toMatchObject({ status: "paid", transfer_id: "tr_earlier" });
  });

  it("a retry that finds nothing sends a transfer with the next attempt number", async () => {
    const r = await readyWorker();
    await verifiedFor(r);
    await processPayouts(store, fakeStripe({ failTransfer: true }), accountReady, T0);
    const stripe = fakeStripe();
    await processPayouts(store, stripe, accountReady, T0 + PAYOUT_RETRY_FUNDS_MS);
    expect(stripe.calls.find((c) => c.op === "transfer")!.args.attempt).toBe(1);
  });

  it("other failures back off 2, 4, 8 minutes, capped at 6 hours", () => {
    const err = new Error("Stripe error 500");
    expect(nextPayoutTry(err, 1, 0)).toBe(2 * 60 * 1000);
    expect(nextPayoutTry(err, 3, 0)).toBe(8 * 60 * 1000);
    expect(nextPayoutTry(err, 20, 0)).toBe(PAYOUT_RETRY_MAX_MS);
    expect(nextPayoutTry(Object.assign(new Error("x"), { code: "balance_insufficient" }), 5, 0)).toBe(PAYOUT_RETRY_FUNDS_MS);
  });

  it("the payout token finds its worker", async () => {
    const out = await registerWorker(store, { agent_name: "a", owner_name: "b", owner_email: "c@d.co" }, T0);
    if ("error" in out) throw new Error(out.error);
    expect(out.payoutUrl).toContain("/api/tasks-payouts?t=");
    expect((await workerForPayoutToken(store, out.payoutToken))?.id).toBe(out.worker.id);
    expect(await workerForPayoutToken(store, "x".repeat(32))).toBeNull();
  });
});

describe("clawbacks and funding events", () => {
  it("a wrong number cancels the unpaid payout, forfeits the bond and reopens the task", async () => {
    const t = await post(phoneTask({ bond_cents: 1000 }));
    const { w } = await worker();
    await creditBondDeposit(store, w.id, { paymentIntent: "pi_1", cents: 1000 }, T0);
    await claimTask(store, await fresh(w.id), t.id, T0);
    await submitResult(store, await fresh(w.id), t.id, goodPhone, T0);
    await decide(store, t.id, "verify", "", T0, "auto");

    const out = await reportWrongNumber(store, "708-555-2210", "CMF call: wrong_number", T0 + 1000);
    expect(out).toEqual({ clawed_back: [expect.objectContaining({ task_id: t.id, cancelled_payouts: 1, forfeited_cents: 1000 })] });
    expect((await fresh(w.id)).status).toBe("paused");
    const after = (await getTask(store, t.id, T0))!;
    expect(after.status).toBe("open");
    expect(after.input.known_phones).toContain("(708) 555-2210");
    expect(await processPayouts(store, fakeStripe(), accountReady, T0)).toMatchObject({ paid: 0 });
  });

  it("deal intros wait for the funding event, and expire if it never comes", async () => {
    const spec = { type: "deal_intro", title: "Intro", input: { desk: "trucking" }, payout_cents: 10000 };
    const intro = { business_name: "Acme", contact_name: "Pat", phone: "708-555-2210", email: "pat@acme.com", need: "Working capital for two trucks", contact_consented: true };
    const a = await post(spec as any);
    const b = await post({ ...spec, title: "Intro 2" } as any);
    const { w } = await worker();
    for (const t of [a, b]) {
      await claimTask(store, await fresh(w.id), t.id, T0);
      expect(await submitResult(store, await fresh(w.id), t.id, intro, T0)).toMatchObject({ verification: { state: "waiting_event" } });
    }
    expect(await pendingVerification(store, T0)).toEqual([]);
    expect(await dealFunded(store, a.id, T0 + 1000)).toMatchObject({ task: { status: "verified" } });
    expect(await expireDealIntros(store, T0 + DEAL_WINDOW_MS + 1)).toBe(1);
    expect((await getTask(store, b.id, T0))!.status).toBe("open");
  });
});

describe("prechecks", () => {
  it("normalizes real numbers and rejects fake ones", () => {
    expect(normPhone("1 (312) 203-8106")).toBe("(312) 203-8106");
    for (const bad of ["555-0100", "312-555-0142", "911-555-1234", "012-345-6789", "222-222-2222", "abc"]) expect(normPhone(bad)).toBeNull();
  });

  it("deal intros need consent", async () => {
    const t = await post({ type: "deal_intro", title: "Trucking capital intro", input: { desk: "trucking" }, payout_cents: 10000 } as any);
    const { w } = await worker();
    await claimTask(store, w, t.id, T0);
    const s = await submitResult(
      store,
      w,
      t.id,
      { business_name: "Acme", contact_name: "Pat", phone: "708-555-2210", email: "pat@acme.com", need: "Needs working capital for two trucks", contact_consented: false },
      T0,
    );
    expect("errors" in s && s.errors).toEqual([expect.stringContaining("contact_consented")]);
  });
});

describe("MCP server", () => {
  async function connected(bearer: string | null = null, alerts: string[] = []) {
    const server = createTaskServer({ store, bearer, notify: (t) => void alerts.push(t), now: () => T0, log: () => undefined });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientT);
    return client;
  }
  const body = (r: any) => JSON.parse(r.content[0].text);

  it("lists the tools and gives instructions", async () => {
    const client = await connected();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["claim_task", "get_task", "list_tasks", "my_account", "post_bond", "register_worker", "release_task", "setup_payouts", "submit_result", "withdraw_bond"]);
    expect(client.getInstructions()).toContain("Fabricated results are fraud");
  });

  it("an agent registers, claims, submits and sees its account", async () => {
    const t = await post();
    const alerts: string[] = [];
    const anon = await connected(null, alerts);
    const listed = body(await anon.callTool({ name: "list_tasks", arguments: {} }));
    expect(listed.tasks.map((x: any) => x.id)).toEqual([t.id]);

    const reg = body(await anon.callTool({ name: "register_worker", arguments: { agent_name: "Hermes", owner_name: "Test Owner", owner_email: "o@example.com" } }));
    expect(reg.worker_key).toMatch(/^cmfw_/);
    expect(reg.payout_setup_url).toContain("/api/tasks-payouts?t=");
    expect(alerts[0]).toContain("new agent registered");

    const noKey = await anon.callTool({ name: "claim_task", arguments: { task_id: t.id } });
    expect(noKey.isError).toBe(true);

    const agent = await connected(reg.worker_key, alerts);
    const claimed = body(await agent.callTool({ name: "claim_task", arguments: { task_id: t.id } }));
    expect(claimed.task.input.dot).toBe("1234567");

    const bad = await agent.callTool({ name: "submit_result", arguments: { task_id: t.id, result: { phone: "nope" } } });
    expect(bad.isError).toBe(true);
    expect((bad.content as any)[0].text).toContain("Precheck failed");

    const good = body(await agent.callTool({ name: "submit_result", arguments: { task_id: t.id, result: goodPhone } }));
    expect(good.precheck).toBe("passed");
    expect(alerts.at(-1)).toContain("verifying automatically");

    const acct = body(await agent.callTool({ name: "my_account", arguments: {} }));
    expect(acct.holding.map((x: any) => x.id)).toEqual([t.id]);

    // The worker_key argument works for clients that can't set headers.
    const viaArg = await connected(null);
    const acct2 = body(await viaArg.callTool({ name: "my_account", arguments: { worker_key: reg.worker_key } }));
    expect(acct2.worker.agent_name).toBe("Hermes");
  });
});

describe("automatic verification", () => {
  const page = (html: string, status = 200) => new Response(html, { status, headers: { "content-type": "text/html" } });
  const twilioOk = { valid: true, line_type_intelligence: { type: "mobile" } };

  /** fetch that serves pages by URL and answers Twilio Lookup. */
  function web(pages: Record<string, Response | (() => Response)>, twilio: unknown = twilioOk) {
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(String(url));
      if (String(url).startsWith("https://lookups.twilio.com/")) return new Response(JSON.stringify(twilio), { status: 200 });
      const p = pages[String(url)];
      if (!p) return page("not found", 404);
      return typeof p === "function" ? p() : p.clone();
    }) as typeof fetch;
    return { fetchImpl, seen };
  }
  const publicDns = async () => ["93.184.216.34"];

  async function submitted(result: Record<string, unknown>, spec: Record<string, unknown> = phoneTask()) {
    const t = await post(spec as any);
    const { w } = await worker();
    await claimTask(store, w, t.id, T0);
    const s = await submitResult(store, await fresh(w.id), t.id, result, T0);
    if (!("precheck" in s) || s.precheck !== "passed") throw new Error("precheck failed");
    return (await getTask(store, t.id, T0))!;
  }

  it("verifies a number shown on the cited page with the carrier's DOT, checked by Twilio", async () => {
    const t = await submitted(goodPhone);
    const { fetchImpl, seen } = web({ "https://example.com/acme": page('<h1>Acme Hauling LLC</h1><p>USDOT 1234567</p><a href="tel:+17085552210">Call</a>') });
    const v = await verifySubmission(t, { fetchImpl, resolve: publicDns, twilio: { sid: "AC1", token: "x" } });
    expect(v).toMatchObject({ decision: "verify" });
    expect(v.note).toContain("Twilio: valid (mobile)");
    expect(seen.some((u) => u.includes("%2B17085552210"))).toBe(true);
  });

  it("rejects when the number isn't on the page, the carrier isn't, or Twilio says invalid", async () => {
    const t = await submitted(goodPhone);
    const deps = (html: string, twilio: unknown = twilioOk): VerifyDeps => ({ ...web({ "https://example.com/acme": page(html) }, twilio), resolve: publicDns, twilio: { sid: "AC1", token: "x" } });
    expect(await verifySubmission(t, deps("Acme Hauling, USDOT 1234567, call 312-203-8106"))).toMatchObject({ decision: "reject", note: expect.stringContaining("isn't on the cited page") });
    expect(await verifySubmission(t, deps("Some Other Co, call (708) 555-2210"))).toMatchObject({ decision: "reject", note: expect.stringContaining("DOT number or name") });
    expect(await verifySubmission(t, deps("Acme Hauling (708) 555-2210", { valid: false }))).toMatchObject({ decision: "reject", note: expect.stringContaining("isn't valid") });
  });

  it("refuses private addresses and retries on server errors", async () => {
    await expect(fetchPage("http://169.254.169.254/latest/meta-data", { resolve: publicDns })).rejects.toThrow("not a public address");
    await expect(fetchPage("https://internal.example/", { resolve: async () => ["10.0.0.5"] })).rejects.toThrow("not a public address");
    // A redirect into a private address is refused too.
    const hop = web({ "https://example.com/r": () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } }) });
    await expect(fetchPage("https://example.com/r", { ...hop, resolve: publicDns })).rejects.toThrow("not a public address");

    const t = await submitted(goodPhone);
    const down = web({ "https://example.com/acme": page("busy", 503) });
    expect(await verifySubmission(t, { ...down, resolve: publicDns })).toMatchObject({ decision: "retry" });
  });

  it("finds numbers written in the usual formats", () => {
    const found = phonesOnPage({ text: "Call 1-708-555-2210 or (312) 203 8106", html: '<a href="tel:7735550123">x</a>' });
    expect([...found].sort()).toEqual(["3122038106", "7085552210", "7735550123"]);
  });

  it("business checks go to the judge with the evidence pages", async () => {
    const spec = { type: "business_check", title: "Diner open?", input: { business_name: "Example Diner", city: "Joliet", state: "IL" }, payout_cents: 350 };
    const t = await submitted({ operating: "yes", evidence_urls: ["https://example.com/reviews"] }, spec);
    const { fetchImpl } = web({ "https://example.com/reviews": page("<p>Example Diner, Joliet. Great pancakes, visited last week.</p>") });
    const asked: any[] = [];
    const judge = async (a: any) => { asked.push(a); return { supports: true, confidence: 0.9, reason: "Recent review" }; };
    expect(await verifySubmission(t, { fetchImpl, resolve: publicDns, judge })).toMatchObject({ decision: "verify" });
    expect(asked[0].pages[0].text).toContain("Great pancakes");
    expect(await verifySubmission(t, { fetchImpl, resolve: publicDns, judge: async () => ({ supports: true, confidence: 0.5, reason: "unclear" }) })).toMatchObject({ decision: "reject" });
    expect(await verifySubmission(t, { fetchImpl, resolve: publicDns, judge: null })).toMatchObject({ decision: "review" });
  });

  it("the job verifies, pays, retries and gives up after 3 tries", async () => {
    const r = await readyWorker();
    const good = await post(phoneTask({ title: "good" }));
    const flaky = await post(phoneTask({ title: "flaky" }));
    for (const t of [good, flaky]) {
      await claimTask(store, await fresh(r.w.id), t.id, T0);
      await submitResult(store, await fresh(r.w.id), t.id, goodPhone, T0);
    }
    const stripe = fakeStripe();
    const verify = async (t: Task) => (t.id === good.id ? { decision: "verify" as const, note: "ok" } : { decision: "retry" as const, note: "site down" });
    const run = () => runTaskBoardJobs({ store, stripe, accountReady, verify, now: () => T0, notify: () => undefined });

    expect(await run()).toMatchObject({ verified: 1, retrying: 1, payouts: { paid: 1 } });
    expect(await run()).toMatchObject({ retrying: 1 });
    expect(await run()).toMatchObject({ rejected: 1 });
    expect((await getTask(store, flaky.id, T0))!.status).toBe("open");
    expect(stripe.calls.filter((c) => c.op === "transfer")).toHaveLength(1);
  });

  it("review verdicts alert CMF and wait", async () => {
    await submitted(goodPhone);
    const alerts: string[] = [];
    const out = await runTaskBoardJobs({ store, stripe: null, accountReady, verify: async () => ({ decision: "review", note: "no key" }), now: () => T0, notify: (m) => void alerts.push(m) });
    expect(out).toMatchObject({ review: 1, payouts: { skipped: "no Stripe key" } });
    expect(alerts[0]).toContain("automatic verification unavailable");
    expect(await pendingVerification(store, T0)).toEqual([]);
  });
});

describe("stripe helpers", () => {
  it("form-encodes nested params the way Stripe expects", () => {
    const q = formEncode({ a: 1, b: { c: "x", d: { e: true } }, items: [{ q: 1 }], skip: null });
    expect(decodeURIComponent(q.toString())).toBe("a=1&b[c]=x&b[d][e]=true&items[0][q]=1");
  });

  it("accepts only correctly signed, fresh webhooks", () => {
    const secret = "whsec_test";
    const body = JSON.stringify({ type: "checkout.session.completed" });
    const t = Math.floor(T0 / 1000);
    const sig = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
    expect(verifyStripeWebhook(body, `t=${t},v1=${sig}`, secret, T0)).toMatchObject({ type: "checkout.session.completed" });
    expect(verifyStripeWebhook(body, `t=${t},v1=${sig}`, "whsec_other", T0)).toBeNull();
    expect(verifyStripeWebhook(body + " ", `t=${t},v1=${sig}`, secret, T0)).toBeNull();
    expect(verifyStripeWebhook(body, `t=${t},v1=${sig}`, secret, T0 + 10 * 60 * 1000)).toBeNull();
  });

  it("an account is ready only when transfers are active", () => {
    expect(accountReady({ capabilities: { transfers: "active" }, payouts_enabled: true })).toBe(true);
    expect(accountReady({ capabilities: { transfers: "pending" } })).toBe(false);
  });
});
