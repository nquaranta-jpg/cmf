import { getSupabase } from "./lib/supabase.mjs";

// CMF Society membership signups. Intentionally SEPARATE from lead.mjs:
// Society joins are community signups, not quote requests, so they must
// never enter the urgent Telegram "CLAIM" / 5-minute escalation flow.
// They land in their own `society_members` table, and storage fails open
// so a DB hiccup never blocks someone from joining (the Telegram notice
// below still fires either way).

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_GROUP_CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID; // fallback

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_FORM_ELAPSED_MS = 1500; // client enforces 2000; allow skew

const INTERESTS = new Set([
  "Workshops",
  "Veterans Chapter",
  "Society Plus Updates",
  "I am a current client",
]);

// Stored alongside each signup so there is a record of exactly what
// the member agreed to at the time they joined.
const CONSENT_TEXT =
  "I agree that Crown Merchant Financial LLC may contact me by phone, text, or email about CMF Society events and insurance products and services. Message and data rates may apply. Consent is not a condition of membership or purchase.";

function cors() {
  return { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
}

function reject(body) {
  return { statusCode: 400, headers: cors(), body: JSON.stringify(body || { ok: false }) };
}

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors(), body: "Method not allowed" };
  }

  let data;
  try { data = JSON.parse(event.body || "{}"); } catch { data = {}; }

  const ip = (event.headers["x-forwarded-for"] || "").split(",")[0].trim()
    || event.headers["client-ip"]
    || "unknown";
  const ua = event.headers["user-agent"] || "unknown";

  // Bot protection: honeypot
  if (data.botField && String(data.botField).trim() !== "") {
    console.log("SOCIETY BOT BLOCKED (honeypot):", JSON.stringify({ ip, ua }));
    return reject({ ok: false, reason: "invalid" });
  }

  // Bot protection: time-trap
  const formElapsedMs = Number(data.formElapsedMs) || 0;
  if (formElapsedMs < MIN_FORM_ELAPSED_MS) {
    console.log("SOCIETY BOT BLOCKED (time-trap):", JSON.stringify({ ip, ua, formElapsedMs }));
    return reject({ ok: false, reason: "invalid" });
  }

  const firstName = (data.firstName || "").toString().trim().slice(0, 80);
  const lastName = (data.lastName || "").toString().trim().slice(0, 80);
  const email = (data.email || "").toString().trim().toLowerCase().slice(0, 160);
  const phoneDigits = (data.phone || "").toString().replace(/\D/g, "");
  const city = (data.city || "").toString().trim().slice(0, 120);
  const interest = INTERESTS.has(data.interest) ? data.interest : "Workshops";
  const eventInterest = (data.eventInterest || "").toString().trim().slice(0, 200);
  const consent = data.consent === true || data.consent === "true";

  const errors = [];
  if (!/[a-zA-Z]{2,}/.test(firstName)) errors.push("firstName");
  if (!/[a-zA-Z]{2,}/.test(lastName)) errors.push("lastName");
  if (!EMAIL_RE.test(email)) errors.push("email");
  if (phoneDigits.length < 10 || phoneDigits.length > 15) errors.push("phone");
  if (!consent) errors.push("consent");
  if (errors.length) {
    console.log("SOCIETY VALIDATION FAILED:", JSON.stringify({ ip, ua, errors }));
    return reject({ ok: false, reason: "validation", errors });
  }

  const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/Chicago" });
  console.log("=== NEW CMF SOCIETY MEMBER ===", JSON.stringify({
    ip, firstName, lastName, email, phone: phoneDigits, city, interest, eventInterest, timestamp,
  }));

  // 1. Store in Supabase (fail open)
  try {
    const supabase = getSupabase();
    const row = {
      first_name: firstName,
      last_name: lastName,
      email,
      phone: phoneDigits,
      city: city || null,
      interest,
      event_interest: eventInterest || null,
      consent: true,
      consent_text: CONSENT_TEXT,
      utm_source: data.utm_source || null,
      utm_medium: data.utm_medium || null,
      utm_campaign: data.utm_campaign || null,
      gclid: data.gclid || null,
    };
    const { error } = await supabase.from("society_members").insert(row);
    if (error) console.error("society-join insert error (failing open):", error);
    else console.log("Society member saved:", email);
  } catch (err) {
    console.error("society-join supabase error (failing open):", err);
  }

  // 2. Telegram notice (plain notification, no CLAIM flow)
  const chatId = TELEGRAM_GROUP_CHAT_ID || TELEGRAM_CHAT_ID;
  if (TELEGRAM_BOT_TOKEN && chatId) {
    const message =
      `🏛 *New CMF Society Member*\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `👤 *Name:* ${firstName} ${lastName}\n` +
      `📧 *Email:* ${email}\n` +
      `📱 *Phone:* ${phoneDigits}\n` +
      `🏙 *City:* ${city || "not given"}\n` +
      `⭐ *Interested in:* ${interest}\n` +
      (eventInterest ? `🎟 *RSVP:* ${eventInterest}\n` : "") +
      `━━━━━━━━━━━━━━━━━━\n` +
      `📍 *Source:* ${data.utm_source || "direct"} / ${data.utm_medium || "none"}\n` +
      `⏰ *Time:* ${timestamp}`;
    try {
      const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "Markdown" }),
      });
      const result = await res.json();
      if (!result.ok) console.error("society-join Telegram API error:", result);
    } catch (err) {
      console.error("society-join Telegram send failed:", err);
    }
  }

  return { statusCode: 200, headers: cors(), body: JSON.stringify({ ok: true }) };
}
