// POST /api/tasks-events: CMF's own systems report real-world outcomes, and
// the Task Board acts on them with no person involved.
//
// Auth: X-Site-Key must equal CMF_SITE_KEY (the key the agent app already
// shares with this site).
//
//   { "type": "deal_funded", "task_id": "t_..." }
//       a deal intro funded: verify it, and the payout goes out on the next run
//   { "type": "call_result", "phone": "...", "outcome": "wrong_number" | "disconnected" | "reached" }
//       a CMF agent dialed a number; wrong_number / disconnected claws back any
//       carrier_phone task verified with it in the last 30 days

import { timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { dealFunded, reportWrongNumber, sendTelegram } from "./lib/taskboard.mjs";

export const config = { path: "/api/tasks-events" };

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

function same(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export default async (req) => {
  const key = process.env.CMF_SITE_KEY;
  if (!key) return json(503, { error: "Not configured: set CMF_SITE_KEY" });
  const sent = req.headers.get("x-site-key");
  if (!sent || !same(sent, key)) return json(401, { error: "Bad key" });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  let body;
  try { body = (await req.json()) || {}; } catch { return json(400, { error: "Body must be JSON" }); }
  const store = getStore({ name: "taskboard", consistency: "strong" });

  try {
    if (body.type === "deal_funded") {
      const out = await dealFunded(store, body.task_id);
      return out.error ? json(400, { error: out.error }) : json(200, { ok: true, status: out.task.status });
    }
    if (body.type === "call_result") {
      if (body.outcome !== "wrong_number" && body.outcome !== "disconnected") return json(200, { ok: true, clawed_back: [] });
      const out = await reportWrongNumber(store, body.phone, `CMF call: ${body.outcome}`);
      if (out.error) return json(400, { error: out.error });
      if (out.clawed_back.length) await sendTelegram(`↩️ Task Board: clawed back ${out.clawed_back.length} task(s) for a ${body.outcome} number. Worker paused, bond forfeited.`);
      return json(200, { ok: true, ...out });
    }
    return json(400, { error: 'type must be "deal_funded" or "call_result"' });
  } catch (err) {
    console.error("tasks-events failed:", err);
    return json(500, { error: "Server error" });
  }
};
