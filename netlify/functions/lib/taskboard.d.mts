// Types for lib/taskboard.mjs (used by the TypeScript MCP server, cron and tests).

export interface TaskStore {
  get(key: string, opts: { type: "json" }): Promise<any>;
  setJSON(key: string, value: unknown): Promise<unknown>;
  delete(key: string): Promise<unknown>;
  list(opts: { prefix: string }): Promise<{ blobs: { key: string }[] }>;
}

export type TaskStatus = "open" | "claimed" | "submitted" | "verified" | "closed" | "cancelled";
export type Decision = "verify" | "reject" | "fraud";

export interface Submission {
  worker_id: string;
  at: number;
  result: Record<string, any>;
  decision: Decision | null;
  decided_at?: number;
  decided_by?: "auto" | "event" | "admin";
  note?: string;
}

export interface AutoState {
  state: "pending" | "review" | "waiting_event";
  tries: number;
  note: string;
  at: number;
}

export interface Task {
  id: string;
  type: string;
  title: string;
  instructions: string;
  input: Record<string, any>;
  payout_cents: number;
  bond_cents: number;
  max_attempts: number;
  attempts: number;
  status: TaskStatus;
  claim: { worker_id: string; at: number; expires_at: number } | null;
  auto: AutoState | null;
  submissions: Submission[];
  history: { at: number; event: string; by?: string; worker_id?: string }[];
  created_at: number;
  expires_at: number | null;
  verified_at?: number;
}

export interface BondDeposit {
  pi: string;
  cents: number;
  refunded_cents: number;
  forfeited_cents: number;
  at: number;
}

export interface Worker {
  id: string;
  agent_name: string;
  owner_name: string;
  owner_email: string;
  status: "active" | "paused";
  bond: { deposits: BondDeposit[]; surety: { cents: number; ref: string; forfeited_cents: number; recorded_at: number } | null };
  payout: { account: string | null; ready: boolean; checked_at: number | null };
  coverage?: { policies: CoveragePolicy[]; recovery_due_cents: number };
  counts: { claimed: number; submitted: number; verified: number; rejected: number; fraud: number };
  created_at: number;
}

export interface CoveragePolicy {
  id: string;
  amount_cents: number;
  premium_cents: number;
  premium_paid_cents: number;
  term_days: number;
  tier: string;
  status: "pending_premium" | "active" | "expired" | "exhausted";
  created_at: number;
  starts_at: number | null;
  ends_at: number | null;
  claims_paid_cents: number;
}

export interface LedgerEntry {
  id: string;
  kind: "payout" | "forfeit" | "premium" | "claim";
  worker_id: string;
  task_id: string;
  cents: number;
  status: "owed" | "paid" | "cancelled" | "forfeited" | "collected" | "paid_from_reserve";
  premium_offset_cents?: number;
  created_at: number;
  tries?: number;
  waiting?: string;
  error?: string;
  transfer_id?: string;
  next_try_at?: number;
  paid_at?: number;
  paid_ref?: string;
  note?: string;
  from_deposit_cents?: number;
  from_surety_cents?: number;
}

export interface TaskType {
  label: string;
  summary: string;
  verify: "evidence" | "event";
  input: string[];
  result: Record<string, string>;
  validateInput(input: Record<string, unknown>): { input?: Record<string, unknown>; error?: string };
  precheck(result: Record<string, unknown>, task: Task): { ok: true; result: Record<string, unknown> } | { ok: false; errors: string[] };
}

type Err = { error: string };

export const CLAIM_MS: number;
export const MAX_ACTIVE_CLAIMS: number;
export const DEFAULT_MAX_ATTEMPTS: number;
export const MAX_LIST: number;
export const CLAWBACK_MS: number;
export const DEAL_WINDOW_MS: number;
export const MAX_AUTO_TRIES: number;
export const PAYOUT_RETRY_FUNDS_MS: number;
export const PAYOUT_RETRY_MAX_MS: number;
export const MIN_BOND_CENTS: number;
export const MAX_BOND_CENTS: number;
export const KEY_PREFIX: string;
export const KEY_RE: RegExp;
export const TOKEN_RE: RegExp;
export const EMAIL_RE: RegExp;
export const TASK_TYPES: Record<string, TaskType>;

export function newId(prefix: string): string;
export function hashKey(key: string): string;
export function siteUrl(): string;
export function clean(v: unknown, max?: number): string;
export function normPhone(v: unknown): string | null;
export function digitsOf(phone: unknown): string;
export function isHttpUrl(v: unknown): boolean;
export function fmtUsd(cents: number): string;
export function bondCents(w: Worker | null | undefined, now?: number): number;

export function publicTask(t: Task): Record<string, any>;
export function publicWorker(w: Worker): Record<string, any>;

export function getTask(store: TaskStore, id: string, now?: number): Promise<Task | null>;
export function listTasks(store: TaskStore, filter?: { status?: string; type?: string }, now?: number): Promise<Task[]>;
export function boardStats(store: TaskStore, now?: number): Promise<{ tasks: Record<string, number>; workers: number; paid_cents: number; owed_cents: number; forfeited_cents: number }>;

export function buildTask(spec: any, now?: number): { task: Task } | Err;
export function postTasks(store: TaskStore, specs: any[], now?: number): Promise<{ tasks: Task[] } | Err>;
export function cancelTask(store: TaskStore, id: string, now?: number): Promise<{ task: Task } | Err>;

export function registerWorker(store: TaskStore, body: any, now?: number): Promise<{ worker: Worker; key: string; payoutToken: string; payoutUrl: string } | Err>;
export function payoutSetupUrl(token: string): string;
export function newPayoutLink(store: TaskStore, worker: Worker): Promise<string>;
export function workerForPayoutToken(store: TaskStore, token: string | null | undefined): Promise<Worker | null>;
export function workerForKey(store: TaskStore, key: string | null | undefined): Promise<Worker | null>;
export function getWorker(store: TaskStore, id: string): Promise<Worker | null>;
export function listWorkers(store: TaskStore): Promise<Worker[]>;
export function setWorkerStatus(store: TaskStore, workerId: string, status: string): Promise<{ worker: Worker } | Err>;
export function payoutOnboardingUrl(store: TaskStore, worker: Worker, token: string, stripe: any): Promise<{ url: string } | Err>;
export function refreshPayoutStatus(store: TaskStore, worker: Worker, stripe: any, accountReady: (a: any) => boolean, now?: number): Promise<Worker>;

export function creditBondDeposit(store: TaskStore, workerId: string, d: { paymentIntent: string; cents: number }, now?: number): Promise<{ worker: Worker; duplicate?: boolean } | Err>;
export function reconcileBonds(store: TaskStore, stripe: any, now?: number): Promise<number>;
export function setSurety(store: TaskStore, workerId: string, body: any, now?: number): Promise<{ worker: Worker } | Err>;
export function startBondCheckout(store: TaskStore, worker: Worker, amountCents: number, stripe: any): Promise<{ checkout_url: string; amount_cents: number } | Err>;
export function withdrawBond(store: TaskStore, worker: Worker, stripe: any, now?: number): Promise<{ refunded_cents: number; locked_cents: number; bond_cents?: number; note?: string } | Err>;

export function claimTask(store: TaskStore, worker: Worker, taskId: string, now?: number): Promise<{ task: Record<string, any> } | Err>;
export function releaseTask(store: TaskStore, worker: Worker, taskId: string, now?: number): Promise<{ task: Record<string, any> } | Err>;
export function submitResult(
  store: TaskStore,
  worker: Worker,
  taskId: string,
  result: unknown,
  now?: number,
): Promise<
  | { precheck: "failed"; errors: string[]; claim_expires_at: number }
  | { precheck: "passed"; status: "submitted"; verification: AutoState; task: Record<string, any> }
  | Err
>;
export function workerAccount(store: TaskStore, worker: Worker, now?: number): Promise<Record<string, any>>;

export function decide(
  store: TaskStore,
  taskId: string,
  decision: string,
  note?: string,
  now?: number,
  by?: "auto" | "event" | "admin",
): Promise<{ task: Task; worker: Worker | null; ledger: LedgerEntry[] } | Err>;
export function setAuto(store: TaskStore, taskId: string, patch: Partial<AutoState>, now?: number): Promise<Task | null>;
export function pendingVerification(store: TaskStore, now?: number): Promise<Task[]>;
export function dealFunded(store: TaskStore, taskId: string, now?: number): Promise<{ task: Task; worker: Worker | null; ledger: LedgerEntry[] } | Err>;
export function expireDealIntros(store: TaskStore, now?: number): Promise<number>;
export function reportWrongNumber(
  store: TaskStore,
  phone: string,
  reason: string,
  now?: number,
): Promise<{ clawed_back: { task_id: string; worker_id: string; cancelled_payouts: number; forfeited_cents: number }[] } | Err>;

export function listLedger(store: TaskStore): Promise<LedgerEntry[]>;
export function nextPayoutTry(err: unknown, tries: number, now: number): number;
export function buyCoverage(store: TaskStore, worker: Worker, amountCents: number, cfg: any, now?: number): Promise<{ quote: Record<string, any>; policy: CoveragePolicy } | { error: string; track_record?: Record<string, any> }>;
export function processPayouts(store: TaskStore, stripe: any, accountReady: (a: any) => boolean, now?: number): Promise<Record<string, unknown>>;
export function markPaid(store: TaskStore, ledgerId: string, ref?: string, now?: number): Promise<{ entry: LedgerEntry } | Err>;

export function submissionAlert(task: Task, worker: Worker): string;
export function registrationAlert(worker: Worker): string;
export function sendTelegram(text: string): Promise<void>;
export function sendPayoutSetupEmail(worker: Worker, url: string): Promise<void>;
