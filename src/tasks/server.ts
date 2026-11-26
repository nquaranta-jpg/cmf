// CMF Task Board MCP server: AI agents find paid tasks, claim them, submit
// results and see what they've earned. Built fresh per request by
// netlify/functions/tasks-mcp.ts (stateless), and directly by tests.
//
// Auth: worker tools need the agent's worker key, sent as
// `Authorization: Bearer cmfw_...` (preferred; the function passes it in as
// deps.bearer) or as the `worker_key` argument for clients that can't set
// headers. list_tasks, get_task and register_worker need no key.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  TASK_TYPES,
  CLAIM_MS,
  MAX_ACTIVE_CLAIMS,
  claimTask,
  getTask,
  listTasks,
  publicTask,
  publicWorker,
  registerWorker,
  registrationAlert,
  releaseTask,
  submissionAlert,
  submitResult,
  workerAccount,
  workerForKey,
  newPayoutLink,
  startBondCheckout,
  withdrawBond,
  MIN_BOND_CENTS,
  MAX_BOND_CENTS,
  type TaskStore,
  type Worker,
} from "../../netlify/functions/lib/taskboard.mjs";

export const TASKS_SERVER_NAME = "cmf-task-board";
export const TASKS_SERVER_VERSION = "0.1.0";

export type TaskServerDeps = {
  store: TaskStore;
  /** Worker key from the request's Authorization header, if any. */
  bearer?: string | null;
  /** Alerts CMF (Telegram in production). */
  notify?: (text: string) => Promise<void> | void;
  /** Stripe client from lib/stripe.mjs (null = money features off). */
  stripe?: any | null;
  /** Emails the owner their payout-setup link. */
  emailPayoutLink?: (worker: Worker, url: string) => Promise<void> | void;
  now?: () => number;
  log?: (entry: Record<string, unknown>) => void;
};

const INSTRUCTIONS = `CMF Task Board, run by Crown Merchant Financial (Chicago). CMF pays for verified work.

How it works:
1. list_tasks shows open tasks with their payout (payout_cents) and any bond required (bond_cents).
2. register_worker once, with the name and email of the person or business that gets paid. Save the worker key it returns; it is shown only once. Send it as "Authorization: Bearer <key>", or as the worker_key argument.
3. claim_task locks a task for you for ${CLAIM_MS / 3_600_000} hours. You can hold ${MAX_ACTIVE_CLAIMS} at a time.
4. submit_result with the fields in the task's result_format. If the precheck fails you get the reasons and can resubmit while your claim lasts.
5. Verification is automatic, usually within minutes (deal intros: when the deal funds). get_task shows where it stands.
6. Verified payouts go automatically, through Stripe, to your owner's connected account. setup_payouts gives the owner's setup link (also emailed at registration).

Bonds: tasks with bond_cents need that much bond posted and not committed elsewhere. post_bond returns a Stripe Checkout link for the owner to pay; withdraw_bond refunds what no open or recently verified (30 days) work depends on.

Rules: submit only what you actually found. Fabricated results are fraud: the task's bond is forfeited and the worker is paused, including when a later CMF call proves a paid phone number wrong. Introduce only people who agreed to hear from CMF.`;

const RESULT_HELP = Object.entries(TASK_TYPES)
  .map(([k, t]) => `${k}: ${Object.keys(t.result).join(", ")}`)
  .join("; ");

function ok(payload: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as Record<string, unknown>,
  };
}

function fail(message: string, extra?: Record<string, unknown>): CallToolResult {
  return { isError: true, content: [{ type: "text", text: extra ? `${message}\n${JSON.stringify(extra, null, 2)}` : message }] };
}

const workerKeyArg = z
  .string()
  .max(200)
  .optional()
  .describe("Your worker key, only if you can't send it as an Authorization: Bearer header");

const taskIdArg = z.string().max(40).describe("Task id, like t_0123456789abcdef");

export function createTaskServer(deps: TaskServerDeps): McpServer {
  const { store } = deps;
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? ((e) => console.log(JSON.stringify({ src: "tasks-mcp", ...e })));
  const notify = deps.notify ?? (() => undefined);
  const emailPayoutLink = deps.emailPayoutLink ?? (() => undefined);
  const stripe = deps.stripe ?? null;

  const server = new McpServer(
    { name: TASKS_SERVER_NAME, title: "CMF Task Board", version: TASKS_SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );

  /** The calling worker, or an error result to return. */
  async function who(argKey?: string): Promise<Worker | CallToolResult> {
    const key = deps.bearer || argKey;
    if (!key) return fail("This tool needs your worker key. Call register_worker first, then send the key as Authorization: Bearer <key>.");
    const w = await workerForKey(store, key);
    return w ?? fail("Unknown worker key.");
  }
  const isWorker = (x: Worker | CallToolResult): x is Worker => typeof (x as Worker).id === "string";

  server.registerTool(
    "list_tasks",
    {
      title: "List open tasks",
      description: "Open tasks CMF will pay for, newest first, with payout, bond required, inputs and the result format to submit.",
      inputSchema: { type: z.enum(Object.keys(TASK_TYPES) as [string, ...string[]]).optional().describe("Only this task type") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ type }) => {
      const tasks = await listTasks(store, { status: "open", type }, now());
      log({ tool: "list_tasks", count: tasks.length });
      return ok({ tasks: tasks.map((t) => publicTask(t)), task_types: Object.fromEntries(Object.entries(TASK_TYPES).map(([k, t]) => [k, { label: t.label, summary: t.summary, result_format: t.result }])) });
    },
  );

  server.registerTool(
    "get_task",
    {
      title: "Get a task",
      description: "One task's details. Your own claimed task includes every input; others show the public view.",
      inputSchema: { task_id: taskIdArg, worker_key: workerKeyArg },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ task_id, worker_key }) => {
      const t = await getTask(store, task_id, now());
      if (!t) return fail("No such task.");
      const key = deps.bearer || worker_key;
      const w = key ? await workerForKey(store, key) : null;
      const mine = w && t.claim?.worker_id === w.id && (t.status === "claimed" || t.status === "submitted");
      return ok({ task: mine ? { ...publicTask(t), input: t.input, verification: t.status === "submitted" ? t.auto : undefined } : publicTask(t) });
    },
  );

  server.registerTool(
    "register_worker",
    {
      title: "Register as a worker",
      description:
        "Register this agent to claim paid tasks. Payouts go to the owner (a person or business), so give the owner's real name and email. Returns a worker key shown only once: store it.",
      inputSchema: {
        agent_name: z.string().max(80).describe("What to call this agent"),
        owner_name: z.string().max(120).describe("Person or business that gets paid"),
        owner_email: z.string().max(200).describe("Owner's email, for payout setup"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) => {
      const out = await registerWorker(store, args, now());
      if ("error" in out) return fail(out.error);
      log({ tool: "register_worker", status: "ok" });
      await Promise.all([notify(registrationAlert(out.worker)), emailPayoutLink(out.worker, out.payoutUrl)]);
      return ok({
        worker: publicWorker(out.worker),
        worker_key: out.key,
        payout_setup_url: out.payoutUrl,
        note: "Save worker_key now; CMF can't show it again. Send it as Authorization: Bearer <key> on every call. Give payout_setup_url to your owner (it was also emailed to them) so payouts can be sent.",
      });
    },
  );

  server.registerTool(
    "claim_task",
    {
      title: "Claim a task",
      description: `Lock an open task for yourself for ${CLAIM_MS / 3_600_000} hours. Returns the full task input. Tasks with bond_cents need a bond on file with CMF that covers them.`,
      inputSchema: { task_id: taskIdArg, worker_key: workerKeyArg },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ task_id, worker_key }) => {
      const w = await who(worker_key);
      if (!isWorker(w)) return w;
      const out = await claimTask(store, w, task_id, now());
      log({ tool: "claim_task", status: "error" in out ? "refused" : "claimed" });
      return "error" in out ? fail(out.error) : ok(out);
    },
  );

  server.registerTool(
    "release_task",
    {
      title: "Release a task",
      description: "Give back a task you claimed but can't finish, so someone else can take it.",
      inputSchema: { task_id: taskIdArg, worker_key: workerKeyArg },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ task_id, worker_key }) => {
      const w = await who(worker_key);
      if (!isWorker(w)) return w;
      const out = await releaseTask(store, w, task_id, now());
      return "error" in out ? fail(out.error) : ok(out);
    },
  );

  server.registerTool(
    "submit_result",
    {
      title: "Submit a result",
      description: `Submit your result for a task you hold. Fields by type: ${RESULT_HELP}. A failed precheck returns the reasons and you can resubmit while your claim lasts. A passed one waits for CMF to verify it.`,
      inputSchema: {
        task_id: taskIdArg,
        result: z.record(z.string(), z.unknown()).describe("The result fields for this task's type (see result_format)"),
        worker_key: workerKeyArg,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ task_id, result, worker_key }) => {
      const w = await who(worker_key);
      if (!isWorker(w)) return w;
      const out = await submitResult(store, w, task_id, result, now());
      if ("error" in out) return fail(out.error);
      log({ tool: "submit_result", precheck: out.precheck });
      if (out.precheck === "failed") return fail("Precheck failed. Fix these and submit again:", { errors: out.errors, claim_expires_at: out.claim_expires_at });
      const t = await getTask(store, task_id, now());
      if (t) await notify(submissionAlert(t, w));
      return ok(out);
    },
  );

  server.registerTool(
    "my_account",
    {
      title: "My account",
      description: "Tasks you hold, your bond (on file, committed, free), and what you've earned: owed, paid and forfeited.",
      inputSchema: { worker_key: workerKeyArg },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ worker_key }) => {
      const w = await who(worker_key);
      if (!isWorker(w)) return w;
      return ok(await workerAccount(store, w, now()));
    },
  );

  server.registerTool(
    "setup_payouts",
    {
      title: "Payout setup link",
      description: "A link for your owner to connect a payout account through Stripe, plus whether payouts are ready. Verified payouts wait until the account is set up, then go out automatically.",
      inputSchema: { worker_key: workerKeyArg },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ worker_key }) => {
      const w = await who(worker_key);
      if (!isWorker(w)) return w;
      if (w.payout?.ready) return ok({ payouts_ready: true, note: "Payouts are set up. Verified tasks are paid automatically." });
      return ok({ payouts_ready: false, payout_setup_url: await newPayoutLink(store, w), note: "Send this link to your owner. It opens Stripe's secure onboarding." });
    },
  );

  server.registerTool(
    "post_bond",
    {
      title: "Post a bond",
      description: `Returns a Stripe Checkout link for your owner to pay a bond (${MIN_BOND_CENTS / 100} to ${MAX_BOND_CENTS / 100} dollars). It is credited automatically once paid. Bonds unlock tasks with bond_cents and are forfeited for fabricated results.`,
      inputSchema: { amount_cents: z.number().int().describe("Bond to post, in cents"), worker_key: workerKeyArg },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ amount_cents, worker_key }) => {
      const w = await who(worker_key);
      if (!isWorker(w)) return w;
      const out = await startBondCheckout(store, w, amount_cents, stripe);
      return "error" in out ? fail(out.error as string) : ok({ ...out, note: "Send this link to your owner. The bond shows in my_account once paid." });
    },
  );

  server.registerTool(
    "withdraw_bond",
    {
      title: "Withdraw unused bond",
      description: "Refunds bond that no open task or task verified in the last 30 days depends on, back to the card that paid it.",
      inputSchema: { worker_key: workerKeyArg },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ worker_key }) => {
      const w = await who(worker_key);
      if (!isWorker(w)) return w;
      const out = await withdrawBond(store, w, stripe, now());
      return "error" in out ? fail(out.error as string) : ok(out);
    },
  );

  return server;
}
