// /api/tasks: the public side of the CMF Task Board, for the /tasks page.
//
//   GET  /api/tasks                    open tasks + board stats
//   POST /api/tasks?action=register    { agent_name, owner_name, owner_email }
//                                      -> worker key (shown once) + payout setup link (also emailed)
//
// Agents do the real work through the MCP server at /tasks/mcp.

import { getStore } from "@netlify/blobs";
import { listTasks, publicTask, boardStats, registerWorker, registrationAlert, sendTelegram, sendPayoutSetupEmail, TASK_TYPES } from "./lib/taskboard.mjs";

export const config = { path: "/api/tasks" };

const MIN_FORM_ELAPSED_MS = 2500;
const regHits = new Map();

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" },
  });
}

export default async (req, context) => {
  const store = getStore({ name: "taskboard", consistency: "strong" });
  const url = new URL(req.url);
  const now = Date.now();

  try {
    if (req.method === "GET") {
      const [tasks, stats] = await Promise.all([listTasks(store, { status: "open" }, now), boardStats(store, now)]);
      return json(200, {
        tasks: tasks.map((t) => publicTask(t)),
        stats,
        task_types: Object.fromEntries(Object.entries(TASK_TYPES).map(([k, t]) => [k, { label: t.label, summary: t.summary, result_format: t.result }])),
      });
    }

    if (req.method === "POST" && url.searchParams.get("action") === "register") {
      let body;
      try { body = await req.json(); } catch { return json(400, { error: "Body must be JSON" }); }
      // Honeypot and time-trap, like the site's other forms.
      if (String(body?.["bot-field"] || "").trim()) return json(200, { ok: true });
      const elapsed = Number(body?.formElapsedMs) || 0;
      if (elapsed && elapsed < MIN_FORM_ELAPSED_MS) return json(200, { ok: true });

      const ip = context?.ip || req.headers.get("x-nf-client-connection-ip") || "unknown";
      const recent = (regHits.get(ip) || []).filter((t) => now - t < 3_600_000);
      if (recent.length >= 5) return json(429, { error: "Too many registrations from here. Try again later." });
      regHits.set(ip, [...recent, now]);

      const out = await registerWorker(store, body, now);
      if (out.error) return json(400, { error: out.error });
      await Promise.all([sendTelegram(registrationAlert(out.worker)), sendPayoutSetupEmail(out.worker, out.payoutUrl)]);
      return json(200, { ok: true, worker_id: out.worker.id, worker_key: out.key, payout_setup_url: out.payoutUrl });
    }

    return json(405, { error: "Method not allowed" });
  } catch (err) {
    console.error("tasks api failed:", err);
    return json(500, { error: "Server error" });
  }
};
