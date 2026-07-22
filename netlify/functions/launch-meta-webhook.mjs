// Meta Lead Ads webhook — STUB, ready to wire up.
//
// What works now:
//   • GET  — Meta's subscription verification handshake (hub.challenge),
//            active once META_VERIFY_TOKEN is set.
//   • POST — signature verification (X-Hub-Signature-256, needs
//            META_APP_SECRET), and the raw event is stored in
//            launch_submissions (form_type=meta_webhook_event) so no
//            lead is ever lost while the full flow is being finished.
//
// To complete the integration (see README "Meta Lead Ads webhook"):
//   1. Set META_VERIFY_TOKEN, META_APP_SECRET, META_PAGE_ACCESS_TOKEN in Netlify.
//   2. Subscribe the Facebook Page to the "leadgen" webhook field, callback:
//        https://<your-site>/.netlify/functions/launch-meta-webhook
//   3. Fill in fetchLeadFields() below — the webhook only carries a
//      leadgen_id; the actual name/email/phone must be fetched from the
//      Graph API — and map page/form ids to a launch_clients row.
import crypto from "node:crypto";
import { getSupabase } from "./lib/supabase.mjs";

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
const APP_SECRET = process.env.META_APP_SECRET;
const PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;

// TODO(meta): fetch full lead field data from the Graph API.
// GET https://graph.facebook.com/v21.0/<leadgen_id>?access_token=<PAGE_ACCESS_TOKEN>
// returns { field_data: [{name, values}], created_time, ... }
async function fetchLeadFields(leadgenId) {
  if (!PAGE_ACCESS_TOKEN) return null;
  const res = await fetch(`https://graph.facebook.com/v21.0/${leadgenId}?access_token=${PAGE_ACCESS_TOKEN}`);
  if (!res.ok) {
    console.error("Meta Graph API error:", res.status, await res.text());
    return null;
  }
  return res.json();
}

// TODO(meta): map a page_id/form_id to the paying client whose ads we
// manage. Simplest approach: add a meta_page_id column (or a small
// launch_meta_mappings table) and look it up here.
function resolveClientId(_pageId, _formId) {
  return null; // unassigned until mapping exists; admin assigns manually
}

function fieldValue(fieldData, name) {
  const f = (fieldData || []).find((x) => x.name === name);
  return f && f.values && f.values[0] ? String(f.values[0]) : "";
}

export async function handler(event) {
  // ── Subscription verification handshake ──
  if (event.httpMethod === "GET") {
    const p = event.queryStringParameters || {};
    if (!VERIFY_TOKEN) {
      return { statusCode: 503, body: "Webhook not configured: set META_VERIFY_TOKEN." };
    }
    if (p["hub.mode"] === "subscribe" && p["hub.verify_token"] === VERIFY_TOKEN) {
      return { statusCode: 200, body: p["hub.challenge"] || "" };
    }
    return { statusCode: 403, body: "Verification failed" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  // ── Signature verification (fail closed once APP_SECRET is set) ──
  if (APP_SECRET) {
    const sig = event.headers["x-hub-signature-256"] || "";
    const expected = "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(event.body || "", "utf8").digest("hex");
    const a = Buffer.from(sig), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      console.log("META WEBHOOK BLOCKED (bad signature)");
      return { statusCode: 401, body: "Invalid signature" };
    }
  } else {
    console.warn("META WEBHOOK: META_APP_SECRET not set — accepting unsigned payload (stub mode)");
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  // Meta disables webhooks that don't answer 200 — never let a config
  // problem (e.g. missing Supabase env) turn into a thrown error.
  let supabase = null;
  try {
    supabase = getSupabase();
  } catch (err) {
    console.error("Meta webhook: Supabase not configured, event dropped:", err.message);
    return { statusCode: 200, body: "EVENT_RECEIVED" };
  }

  // Always archive the raw event first so nothing is lost.
  try {
    await supabase.from("launch_submissions").insert({
      form_type: "meta_webhook_event",
      payload: body,
      ip: (event.headers["x-forwarded-for"] || "").split(",")[0].trim(),
      user_agent: event.headers["user-agent"] || "",
    });
  } catch (err) {
    console.error("Meta webhook archive error:", err);
  }

  // Process leadgen changes into launch_leads (needs PAGE_ACCESS_TOKEN).
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== "leadgen" || !change.value) continue;
      const { leadgen_id, page_id, form_id } = change.value;
      if (!leadgen_id) continue;

      const detail = await fetchLeadFields(leadgen_id).catch((err) => {
        console.error("Meta lead fetch failed:", err);
        return null;
      });

      const lead = {
        client_id: resolveClientId(page_id, form_id),
        name: fieldValue(detail?.field_data, "full_name"),
        phone: fieldValue(detail?.field_data, "phone_number"),
        email: fieldValue(detail?.field_data, "email"),
        lead_type: "final_expense", // TODO(meta): derive from form_id mapping
        source: "meta",
        meta_lead_id: String(leadgen_id),
        raw: change.value,
      };

      try {
        // meta_lead_id has a unique index — retries from Meta won't duplicate
        const { error } = await supabase.from("launch_leads").upsert(lead, { onConflict: "meta_lead_id", ignoreDuplicates: true });
        if (error) console.error("Meta lead insert error:", error);
        else console.log("Meta lead ingested:", leadgen_id);
      } catch (err) {
        console.error("Meta lead insert exception:", err);
      }
    }
  }

  // Meta requires a fast 200 regardless; failures are logged and the raw
  // event is archived for replay.
  return { statusCode: 200, body: "EVENT_RECEIVED" };
}
