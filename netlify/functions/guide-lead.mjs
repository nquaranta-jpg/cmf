import { getSupabase } from "./lib/supabase.mjs";

// Guide-download capture. This is intentionally SEPARATE from lead.mjs:
// guide downloads are low-intent email captures, so they must never enter
// the urgent Telegram "CLAIM" / 5-minute escalation flow that real quote
// requests go through. They land in their own `guide_leads` table for
// nurture, and storage fails open — a DB hiccup must not stop the visitor
// from getting their guide (the conversion pixel already fired client-side).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors(), body: "Method not allowed" };
  }

  let data;
  try { data = JSON.parse(event.body || "{}"); } catch { data = {}; }

  const name = (data.name || "").toString().trim().slice(0, 120);
  const email = (data.email || "").toString().trim().toLowerCase();
  const phone = (data.phone || "").toString().replace(/\D/g, "").slice(0, 15);

  if (!EMAIL_RE.test(email)) {
    return { statusCode: 400, headers: cors(), body: JSON.stringify({ ok: false, reason: "email" }) };
  }

  try {
    const supabase = getSupabase();
    const row = {
      name: name || null,
      email,
      phone: phone || null,
      source: (data.source || "vgli-calculator").toString().slice(0, 60),
      utm_source: data.utm_source || null,
      utm_medium: data.utm_medium || null,
      utm_campaign: data.utm_campaign || null,
      gclid: data.gclid || null,
    };
    let { error } = await supabase.from("guide_leads").insert(row);
    if (error && "phone" in row) {
      // Schema drift guard: if the table predates the phone column, a
      // PostgREST unknown-column error rejects the WHOLE insert. Losing the
      // phone beats silently losing the lead — retry without it.
      console.error("guide-lead insert failed, retrying without phone:", error);
      delete row.phone;
      ({ error } = await supabase.from("guide_leads").insert(row));
    }
    if (error) console.error("guide-lead insert error:", error);
    else console.log("Guide lead saved:", email);
  } catch (err) {
    console.error("guide-lead supabase error (failing open):", err);
  }

  return { statusCode: 200, headers: cors(), body: JSON.stringify({ ok: true }) };
}

function cors() {
  return { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
}
