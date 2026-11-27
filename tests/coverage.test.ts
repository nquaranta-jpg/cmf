import { describe, it, expect, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  postTasks,
  registerWorker,
  claimTask,
  submitResult,
  decide,
  getWorker,
  bondCents,
  buyCoverage,
  processPayouts,
  workerAccount,
  creditBondDeposit,
  listLedger,
  type TaskStore,
  type Task,
  type Worker,
} from "../netlify/functions/lib/taskboard.mjs";
import { coverageConfig, trackRecord, quoteCoverage, coverageCapacity, coverageBook, publicCoverage } from "../netlify/functions/lib/coverage.mjs";
import { accountReady } from "../netlify/functions/lib/stripe.mjs";
import { createTaskServer } from "../src/tasks/server.js";

function memStore(): TaskStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async get(key) { const v = data.get(key); return v === undefined ? null : JSON.parse(v); },
    async setJSON(key, value) { data.set(key, JSON.stringify(value)); },
    async delete(key) { data.delete(key); },
    async list({ prefix }) { return { blobs: [...data.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; },
  };
}

const T0 = Date.UTC(2026, 10, 27, 15, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
// Test-only numbers; real tiers and rates come from Nick's COVERAGE_TIERS.
const ENV = {
  COVERAGE_ENABLED: "true",
  COVERAGE_ISSUER: "Example Issuer LLC",
  COVERAGE_ISSUER_LICENSE: "TEST-123",
  COVERAGE_TERMS_URL: "https://example.com/terms",
  COVERAGE_TERM_DAYS: "30",
  COVERAGE_TIERS: JSON.stringify({ established: { max_cents: 10000, rate_bps: 500 }, trusted: { max_cents: 50000, rate_bps: 300 } }),
  COVERAGE_CAPITAL_CENTS: "100000",
};
const cfg = coverageConfig(ENV)!;

let store: ReturnType<typeof memStore>;
beforeEach(() => { store = memStore(); });

async function worker(counts: Partial<Worker["counts"]> = {}, ready = true) {
  const out = await registerWorker(store, { agent_name: "A", owner_name: "Owner", owner_email: "o@example.com" }, T0);
  if ("error" in out) throw new Error(out.error);
  const w = out.worker;
  w.counts = { ...w.counts, ...counts };
  if (ready) w.payout = { account: "acct_x", ready: true, checked_at: T0 };
  await store.setJSON(`worker/${w.id}`, w);
  return w;
}
const fresh = async (id: string) => (await getWorker(store, id))!;

function fakeStripe() {
  const calls: any[] = [];
  return {
    calls,
    async transfer(a: any) { calls.push(a); return { id: "tr_" + a.ledgerId }; },
    async findTransfer() { return null; },
    async getAccount() { return { capabilities: { transfers: "active" }, payouts_enabled: true }; },
  };
}

async function owedPayout(w: Worker, cents: number) {
  const out = await postTasks(store, [{ type: "carrier_phone", title: "t", input: { dot: "123" }, payout_cents: cents }], T0);
  if ("error" in out) throw new Error(out.error);
  const t = out.tasks[0];
  await claimTask(store, await fresh(w.id), t.id, T0);
  await submitResult(store, await fresh(w.id), t.id, { phone: "708-555-2210", source_url: "https://example.com" }, T0);
  await decide(store, t.id, "verify", "", T0, "auto");
  return t;
}

describe("settings", () => {
  it("stays off unless every required setting is present", () => {
    expect(coverageConfig({})).toBeNull();
    expect(coverageConfig({ ...ENV, COVERAGE_ENABLED: "false" })).toBeNull();
    expect(coverageConfig({ ...ENV, COVERAGE_ISSUER: "" })).toBeNull();
    expect(coverageConfig({ ...ENV, COVERAGE_TERMS_URL: "http://insecure.example" })).toBeNull();
    expect(coverageConfig({ ...ENV, COVERAGE_TIERS: "not json" })).toBeNull();
    expect(cfg).toMatchObject({ name: "Agent Bond", term_days: 30, capital_cents: 100000 });
    expect(publicCoverage(null)).toEqual({ enabled: false });
  });
});

describe("track record", () => {
  it("tiers come from verified work and reject rate; any fraud makes an agent ineligible", async () => {
    expect(trackRecord(await worker({ verified: 3 }), T0).tier).toBe("new");
    expect(trackRecord(await worker({ verified: 12, rejected: 2 }), T0).tier).toBe("established");
    expect(trackRecord(await worker({ verified: 60, rejected: 5 }), T0).tier).toBe("trusted");
    expect(trackRecord(await worker({ verified: 60, rejected: 20 }), T0).tier).toBe("established");
    expect(trackRecord(await worker({ verified: 60, rejected: 30 }), T0).tier).toBe("new"); // 33% rejects
    expect(trackRecord(await worker({ verified: 200, fraud: 1 }), T0).tier).toBe("ineligible");
  });
});

describe("quote and buy", () => {
  it("prices from the agent's tier and refuses new agents and amounts over the tier max", async () => {
    expect(quoteCoverage(await worker({ verified: 2 }), 5000, cfg, T0).error).toMatch(/Not eligible yet/);
    const est = await worker({ verified: 12 });
    expect(quoteCoverage(est, 5000, cfg, T0)).toMatchObject({ tier: "established", amount_cents: 5000, premium_cents: 250, issuer: "Example Issuer LLC" });
    expect(quoteCoverage(est, 20000, cfg, T0).error).toMatch(/up to 10000/);
    expect(quoteCoverage(est, 5000, null, T0).error).toMatch(/isn't offered/);
  });

  it("buying starts a policy that waits for its fee; only one at a time", async () => {
    const w = await worker({ verified: 12 });
    const out = await buyCoverage(store, w, 5000, cfg, T0);
    expect(out).toMatchObject({ policy: { status: "pending_premium", premium_cents: 250 } });
    expect(await buyCoverage(store, await fresh(w.id), 5000, cfg, T0)).toEqual({ error: expect.stringMatching(/already has coverage/) });
    expect(coverageCapacity(await fresh(w.id), T0)).toBe(0);
  });
});

describe("fees from earnings", () => {
  it("takes the fee out of payouts, activates when paid, and sends the rest", async () => {
    const w = await worker({ verified: 12 });
    await buyCoverage(store, w, 5000, cfg, T0); // fee 250
    await owedPayout(w, 100); // fully applied to the fee
    await owedPayout(w, 400); // 150 to the fee, 250 sent
    const stripe = fakeStripe();
    const out = await processPayouts(store, stripe as any, accountReady, T0);
    expect(out).toMatchObject({ paid: 2, coverage_activated: 1 });
    expect(stripe.calls.map((c) => c.amount)).toEqual([250]);
    const after = await fresh(w.id);
    expect(coverageCapacity(after, T0)).toBe(5000);
    expect(bondCents(after, T0)).toBe(5000);
    const fees = (await listLedger(store)).filter((l) => l.kind === "premium");
    expect(fees.reduce((s, l) => s + l.cents, 0)).toBe(250);
    // Coverage ends with its term.
    expect(coverageCapacity(after, T0 + 31 * DAY)).toBe(0);
  });
});

describe("claims", () => {
  it("active coverage backs bonded tasks; fraud uses the deposit first, then coverage, and the owner owes the issuer", async () => {
    const w = await worker({ verified: 12 });
    await buyCoverage(store, w, 5000, cfg, T0);
    await owedPayout(w, 300);
    await processPayouts(store, fakeStripe() as any, accountReady, T0);
    await creditBondDeposit(store, w.id, { paymentIntent: "pi_1", cents: 1000 }, T0);
    expect(bondCents(await fresh(w.id), T0)).toBe(6000);

    const out = await postTasks(store, [{ type: "carrier_phone", title: "bonded", input: { dot: "9" }, payout_cents: 100, bond_cents: 3000 }], T0);
    if ("error" in out) throw new Error(out.error);
    const t = out.tasks[0];
    expect(await claimTask(store, await fresh(w.id), t.id, T0)).toHaveProperty("task");
    await submitResult(store, await fresh(w.id), t.id, { phone: "708-555-3301", source_url: "https://example.com" }, T0);
    const d = await decide(store, t.id, "fraud", "fabricated", T0);
    if ("error" in d) throw new Error(d.error);
    expect(d.ledger).toEqual([
      expect.objectContaining({ kind: "forfeit", cents: 1000, from_deposit_cents: 1000 }),
      expect.objectContaining({ kind: "claim", cents: 2000, status: "paid_from_reserve" }),
    ]);
    const after = await fresh(w.id);
    expect(after.status).toBe("paused");
    expect(after.coverage!.recovery_due_cents).toBe(2000);
    expect(coverageCapacity(after, T0)).toBe(3000);
    const book = coverageBook(await listLedger(store), [after], cfg);
    expect(book).toMatchObject({ premiums_collected_cents: 250, claims_paid_cents: 2000, recovery_due_cents: 2000, reserve_cents: 100000 + 250 - 2000 });
    expect((await workerAccount(store, after, T0)).coverage).toMatchObject({ owed_to_issuer_cents: 2000, active_cents: 3000 });
  });
});

describe("MCP tools", () => {
  async function client(coverage: any, bearer: string | null = null) {
    const server = createTaskServer({ store, bearer, coverage, notify: () => undefined, now: () => T0, log: () => undefined });
    const [c, s] = InMemoryTransport.createLinkedPair();
    await server.connect(s);
    const cl = new Client({ name: "t", version: "0" });
    await cl.connect(c);
    return cl;
  }

  it("coverage tools exist only when coverage is on, and buying needs the owner's acceptance", async () => {
    const off = await client(null);
    expect((await off.listTools()).tools.map((t) => t.name)).not.toContain("buy_coverage");

    const reg = await registerWorker(store, { agent_name: "A", owner_name: "O", owner_email: "o@example.com" }, T0);
    if ("error" in reg) throw new Error(reg.error);
    const w = reg.worker;
    w.counts.verified = 12;
    await store.setJSON(`worker/${w.id}`, w);
    const on = await client(cfg, reg.key);
    const names = (await on.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["quote_coverage", "buy_coverage"]));
    const q = await on.callTool({ name: "quote_coverage", arguments: { amount_cents: 5000 } });
    expect(JSON.parse((q.content as any)[0].text)).toMatchObject({ premium_cents: 250, terms_url: "https://example.com/terms" });
    const no = await on.callTool({ name: "buy_coverage", arguments: { amount_cents: 5000, accept_terms: false } });
    expect(no.isError).toBe(true);
    const yes = await on.callTool({ name: "buy_coverage", arguments: { amount_cents: 5000, accept_terms: true } });
    expect(JSON.parse((yes.content as any)[0].text)).toMatchObject({ policy: { status: "pending_premium" } });
  });
});
