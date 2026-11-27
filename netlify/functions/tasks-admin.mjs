// /api/tasks-admin: CMF's side of the Task Board. Auth: X-Dashboard-Pin,
// checked by lib/pin.mjs (constant-time, per-IP lockout, fails closed).
//
//   GET  ?action=overview                         every task, worker and ledger entry + stats
//   POST ?action=post      { tasks: [spec, ...] } or one spec
//                          spec = { type, title, instructions?, input, payout_cents, bond_cents?, max_attempts?, expires_at? }
//   POST ?action=decide    { task_id, decision: "verify" | "reject" | "fraud", note? }   override; verification is automatic
//   POST ?action=cancel    { task_id }
//   POST ?action=surety    { worker_id, cents, ref }   a third-party surety bond (cents 0 clears it);
//                          cash deposits arrive by themselves through Stripe Checkout
//   POST ?action=worker    { worker_id, status: "active" | "paused" }
//   POST ?action=paid      { ledger_id, ref? }   override: a payout made outside Stripe

import { getStore } from "@netlify/blobs";
import { checkPin } from "./lib/pin.mjs";
import { coverageConfig, coverageBook } from "./lib/coverage.mjs";
import {
  listTasks,
  listWorkers,
  listLedger,
  boardStats,
  postTasks,
  decide,
  cancelTask,
  setSurety,
  setWorkerStatus,
  markPaid,
  TASK_TYPES,
} from "./lib/taskboard.mjs";

export const config = { path: "/api/tasks-admin" };

const MAX_POST = 100;

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

export default async (req) => {
  const auth = await checkPin(req.headers.get("x-dashboard-pin"), req.headers);
  if (!auth.ok) return json(auth.status, { error: auth.error });

  const store = getStore({ name: "taskboard", consistency: "strong" });
  const action = new URL(req.url).searchParams.get("action");
  const now = Date.now();

  try {
    if (req.method === "GET" && action === "overview") {
      const [tasks, workers, ledger, stats] = await Promise.all([listTasks(store, {}, now), listWorkers(store), listLedger(store), boardStats(store, now)]);
      const types = Object.fromEntries(Object.entries(TASK_TYPES).map(([k, t]) => [k, { label: t.label, input: t.input, result_format: t.result }]));
      const cfg = coverageConfig();
      const coverage = { config: cfg, book: coverageBook(ledger, workers, cfg) };
      return json(200, { now, tasks, workers, ledger, stats, task_types: types, coverage });
    }

    if (req.method !== "POST") return json(400, { error: "Unknown action" });
    let body;
    try { body = (await req.json()) || {}; } catch { return json(400, { error: "Body must be JSON" }); }

    let out;
    switch (action) {
      case "post": {
        const specs = Array.isArray(body.tasks) ? body.tasks : [body];
        if (specs.length > MAX_POST) return json(400, { error: `At most ${MAX_POST} tasks per request` });
        out = await postTasks(store, specs, now);
        break;
      }
      case "decide":
        out = await decide(store, body.task_id, body.decision, body.note, now);
        break;
      case "cancel":
        out = await cancelTask(store, body.task_id, now);
        break;
      case "surety":
        out = await setSurety(store, body.worker_id, body, now);
        break;
      case "worker":
        out = await setWorkerStatus(store, body.worker_id, body.status);
        break;
      case "paid":
        out = await markPaid(store, body.ledger_id, body.ref, now);
        break;
      default:
        return json(400, { error: "Unknown action" });
    }
    return out.error ? json(400, { error: out.error }) : json(200, { ok: true, ...out });
  } catch (err) {
    console.error("tasks-admin failed:", err);
    return json(500, { error: "Server error" });
  }
};
