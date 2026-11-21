// /api/visit-admin: mint tagged links and read who has been on the site.
//
// Auth (fails closed): X-Dashboard-Pin must equal DASHBOARD_PIN (the
// dashboard: every action), or X-Track-Key must equal CMF_SITE_KEY (scripts
// such as an email sender: mint only, so a leaked key can't read or delete
// anyone's history). CMF_SITE_KEY is optional and unset by default.
//
//   GET  ?action=activity&days=30     people seen recently, newest first
//   GET  ?action=lead&t=<token>       one person's history (or &email=)
//   POST ?action=mint                 { email, name?, source?, lead_id?, url? }
//                                     or { rows: [{ email, name?, lead_id?, url? }], source?, url? }
//                                     returns tagged links; one token per email, reused
//   POST ?action=forget               { token } or { email }: delete everything held on them

import { timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { listActivity, history, mint, mintMany, tagUrl, forget, findToken, EMAIL_RE, normEmail } from "./lib/visits.mjs";

export const config = { path: "/api/visit-admin" };

const MAX_ROWS = 200;

/** Asks the agent app to clear its copy of a lead's visits. "cleared", "not found" or "failed". */
async function forgetInApp(leadId, email) {
  const key = process.env.CMF_SITE_KEY;
  if (!key) return "failed";
  const base = (process.env.CMF_APP_URL || "https://app.crownmerchantfinancial.com").replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/api/site-visits/forget`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Site-Key": key },
      body: JSON.stringify({ lead_id: leadId, email }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return "failed";
    const d = await res.json().catch(() => ({}));
    return d.ok ? "cleared" : "not found";
  } catch {
    return "failed";
  }
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function same(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** "pin" (full access), "key" (mint only) or null. */
function role(req) {
  const pin = process.env.DASHBOARD_PIN;
  const key = process.env.CMF_SITE_KEY;
  const sentPin = req.headers.get("x-dashboard-pin");
  const sentKey = req.headers.get("x-track-key");
  if (pin && sentPin && same(sentPin, pin)) return "pin";
  if (key && sentKey && same(sentKey, key)) return "key";
  return null;
}

export default async (req) => {
  if (!process.env.DASHBOARD_PIN && !process.env.CMF_SITE_KEY) {
    return json(503, { error: "Not configured: set DASHBOARD_PIN in Netlify." });
  }
  const who = role(req);
  if (!who) return json(401, { error: "Invalid PIN" });

  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  if (who === "key" && !(req.method === "POST" && action === "mint")) {
    return json(403, { error: "This key can only mint links" });
  }
  const store = getStore({ name: "visits", consistency: "strong" });
  const now = Date.now();

  try {
    if (req.method === "GET" && action === "activity") {
      const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days")) || 30));
      const { rows, totals, truncated } = await listActivity(store, { days }, now);
      return json(200, { now, people: rows, totals, truncated });
    }

    if (req.method === "GET" && action === "lead") {
      let token = url.searchParams.get("t");
      const email = url.searchParams.get("email");
      if (!token && email) token = await findToken(store, email);
      const h = token ? await history(store, token) : null;
      return h ? json(200, { now, ...h }) : json(404, { error: "Not found" });
    }

    if (req.method === "POST" && (action === "mint" || action === "forget")) {
      let body;
      try { body = await req.json(); } catch { return json(400, { error: "Body must be JSON" }); }
      body = body || {};

      if (action === "forget") {
        if (!body.token && !body.email) return json(400, { error: "Send token or email" });
        const gone = await forget(store, { token: body.token, email: body.email });
        // The agent app keeps a copy of a primer lead's visits: clear it too.
        const app = gone.lead_id ? await forgetInApp(gone.lead_id, gone.email) : null;
        return json(200, { deleted: gone.deleted, token: gone.token, app });
      }

      const target = body.url || "/";
      if (!tagUrl(target, "x".repeat(16))) {
        return json(400, { error: "Links must point to a public page on crownmerchantfinancial.com (like /launch or /quote)" });
      }

      if (Array.isArray(body.rows)) {
        if (body.rows.length > MAX_ROWS) return json(400, { error: `At most ${MAX_ROWS} rows per request` });
        const bad = body.rows.find((r) => r?.url && !tagUrl(r.url, "x".repeat(16)));
        if (bad) return json(400, { error: `Not a trackable crownmerchantfinancial.com page: ${String(bad.url).slice(0, 100)}` });
        const results = await mintMany(store, body.rows, { source: body.source, url: target }, now);
        return json(200, { results });
      }

      if (!EMAIL_RE.test(normEmail(body.email))) return json(400, { error: "A valid email is required" });
      const m = await mint(store, body, now);
      if (m.error) return json(400, { error: m.error });
      return json(200, { email: m.record.email, name: m.record.name, lead_id: m.record.lead_id, token: m.token, created: m.created, link: tagUrl(target, m.token) });
    }

    return json(400, { error: "Unknown action" });
  } catch (err) {
    console.error("visit-admin failed:", err);
    return json(500, { error: "Server error" });
  }
};
