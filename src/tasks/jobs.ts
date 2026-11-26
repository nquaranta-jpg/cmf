// The Task Board's automatic work, separated from the scheduled function so
// tests can run it with fakes.

import {
  decide,
  expireDealIntros,
  getWorker,
  MAX_AUTO_TRIES,
  pendingVerification,
  processPayouts,
  reconcileBonds,
  sendTelegram,
  setAuto,
  type Task,
  type TaskStore,
} from "../../netlify/functions/lib/taskboard.mjs";
import type { Verdict } from "./verify.js";

export type JobDeps = {
  store: TaskStore;
  stripe: any | null;
  accountReady: (acct: any) => boolean;
  verify: (t: Task) => Promise<Verdict>;
  budgetMs?: number;
  now?: () => number;
  notify?: (text: string) => Promise<void> | void;
};

export async function runTaskBoardJobs(deps: JobDeps) {
  const now = deps.now ?? (() => Date.now());
  const notify = deps.notify ?? sendTelegram;
  const started = now();
  const budget = deps.budgetMs ?? 20_000;
  const out = { bonds_credited: 0, verified: 0, rejected: 0, retrying: 0, review: 0, skipped_for_time: 0, payouts: {} as Record<string, unknown>, deal_intros_expired: 0 };

  // Bonds first, so a bond paid a minute ago already counts for claims and payouts.
  try {
    out.bonds_credited = await reconcileBonds(deps.store, deps.stripe, now());
  } catch (err) {
    console.error("bond reconcile failed:", (err as Error).message);
  }

  for (const t of await pendingVerification(deps.store, now())) {
    if (now() - started > budget) {
      out.skipped_for_time += 1;
      continue;
    }
    let v: Verdict;
    try {
      v = await deps.verify(t);
    } catch (err) {
      v = { decision: "retry", note: `Verifier error: ${(err as Error).message}` };
    }
    if (v.decision === "verify" || v.decision === "reject") {
      await decide(deps.store, t.id, v.decision, v.note, now(), "auto");
      out[v.decision === "verify" ? "verified" : "rejected"] += 1;
    } else if (v.decision === "retry") {
      const tries = (t.auto?.tries || 0) + 1;
      if (tries >= MAX_AUTO_TRIES) {
        await decide(deps.store, t.id, "reject", `Couldn't verify after ${tries} tries: ${v.note}`, now(), "auto");
        out.rejected += 1;
      } else {
        await setAuto(deps.store, t.id, { state: "pending", tries, note: v.note }, now());
        out.retrying += 1;
      }
    } else {
      await setAuto(deps.store, t.id, { state: "review", note: v.note }, now());
      const w = await getWorker(deps.store, t.submissions.at(-1)!.worker_id);
      await notify(`⚠️ Task Board: automatic verification unavailable\n${t.title}\n${v.note}\nFrom ${w?.agent_name || "unknown agent"}. Decide it at /dashboard/tasks.`);
      out.review += 1;
    }
  }

  out.payouts = await processPayouts(deps.store, deps.stripe, deps.accountReady, now());
  out.deal_intros_expired = await expireDealIntros(deps.store, now());
  return out;
}
