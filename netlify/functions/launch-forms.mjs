// CMF Launch public form endpoint. Handles all four capture forms:
//   iul_optin          — free IUL training lead magnet (email-gated)
//   leads_inquiry      — lead package tier inquiry
//   ads_application    — done-for-you Meta ads application
//   match_application  — CMF Match application
// Stores every submission in launch_submissions and notifies Telegram.
import { getSupabase } from "./lib/supabase.mjs";
import {
  EMAIL_RE, URL_IN_NAME_RE, MIN_FORM_ELAPSED_MS, DISPOSABLE_DOMAINS,
  emailDomain, checkRateLimit, verifyTurnstile, clientIp,
} from "./lib/launch-spam.mjs";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT = process.env.TELEGRAM_GROUP_CHAT_ID || process.env.TELEGRAM_CHAT_ID;

const FORM_TYPES = {
  iul_optin: { label: "IUL Training Opt-in", phoneRequired: false },
  leads_inquiry: { label: "Lead Package Inquiry", phoneRequired: true },
  ads_application: { label: "Meta Ads Application", phoneRequired: true },
  training_inquiry: { label: "Coaching Consult Request", phoneRequired: true },
  match_application: { label: "CMF Match Application", phoneRequired: true },
};

// Whitelist of extra fields stored in the payload column, per form.
const PAYLOAD_FIELDS = [
  "states", "licensedYears", "currentCarrier", "tier", "monthlyBudget",
  "runningAdsNow", "leadVolumeGoal", "productFocus", "teamSize",
  "productionLevel", "whyMatch", "message",
];

function reject(reason, extra) {
  return {
    statusCode: 400,
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(extra || { ok: false, reason }),
  };
}

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch {
    return reject("invalid json");
  }

  const ip = clientIp(event);
  const ua = event.headers["user-agent"] || "unknown";
  const form = FORM_TYPES[data.formType];
  if (!form) return reject("unknown form");

  const name = (data.name || "").trim();
  const email = (data.email || "").trim();
  const phone = (data.phone || "").trim();

  // ── Bot protection: honeypot ──
  if (data.botField && String(data.botField).trim() !== "") {
    console.log("LAUNCH BOT BLOCKED (honeypot):", JSON.stringify({ ip, ua, email }));
    return reject("invalid");
  }

  // ── Bot protection: time-trap ──
  const formElapsedMs = Number(data.formElapsedMs) || 0;
  if (formElapsedMs < MIN_FORM_ELAPSED_MS) {
    console.log("LAUNCH BOT BLOCKED (time-trap):", JSON.stringify({ ip, ua, formElapsedMs, email }));
    return reject("invalid");
  }

  // ── Format validation ──
  const errors = [];
  if (!name || !/[a-zA-Z]{2,}/.test(name) || URL_IN_NAME_RE.test(name)) errors.push("name");
  if (!email || !EMAIL_RE.test(email)) errors.push("email");
  const phoneDigits = phone.replace(/\D/g, "");
  if (form.phoneRequired && (phoneDigits.length < 10 || phoneDigits.length > 15)) errors.push("phone");
  if (errors.length) {
    console.log("LAUNCH VALIDATION FAILED:", JSON.stringify({ ip, ua, errors, email }));
    return reject("validation", { ok: false, errors });
  }

  // ── Bot protection: disposable email ──
  if (DISPOSABLE_DOMAINS.has(emailDomain(email))) {
    console.log("LAUNCH BOT BLOCKED (disposable email):", JSON.stringify({ ip, ua, email }));
    return reject("invalid");
  }

  // ── Bot protection: per-IP rate limit ──
  const rateLimit = await checkRateLimit(ip);
  if (!rateLimit.allowed) {
    console.log("LAUNCH BOT BLOCKED (rate limit):", JSON.stringify({ ip, ua, count: rateLimit.count }));
    return reject("invalid");
  }

  // ── Bot protection: Turnstile (active when secret is configured) ──
  const turnstile = await verifyTurnstile(data.turnstileToken || "", ip);
  if (!turnstile.ok) {
    console.log("LAUNCH BOT BLOCKED (turnstile):", JSON.stringify({ ip, ua, reason: turnstile.reason }));
    return reject("invalid");
  }

  const payload = {};
  for (const key of PAYLOAD_FIELDS) {
    if (data[key] !== undefined && data[key] !== "") payload[key] = String(data[key]).slice(0, 2000);
  }

  console.log("=== NEW CMF LAUNCH SUBMISSION ===", JSON.stringify({ formType: data.formType, ip, name, email, phone, payload }));

  // ── Store in Supabase ──
  let stored = false;
  try {
    const { error } = await getSupabase().from("launch_submissions").insert({
      form_type: data.formType,
      name, email, phone,
      payload,
      ip,
      user_agent: ua.slice(0, 500),
    });
    if (error) console.error("Launch submission insert error:", error);
    else stored = true;
  } catch (err) {
    console.error("Launch submission Supabase error:", err);
  }

  // ── Telegram notification (best-effort) ──
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT) {
    const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/Chicago" });
    const payloadLines = Object.entries(payload)
      .map(([k, v]) => `• *${k}:* ${v}`)
      .join("\n");
    const message =
      `🚀 *CMF Launch — ${form.label}*\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `👤 *Name:* ${name}\n` +
      `📧 *Email:* ${email}\n` +
      (phone ? `📱 *Phone:* ${phone}\n` : "") +
      (payloadLines ? payloadLines + "\n" : "") +
      `━━━━━━━━━━━━━━━━━━\n` +
      `⏰ *Time:* ${timestamp}${stored ? "" : "\n⚠️ Not saved to database — check function logs"}`;
    try {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT, text: message, parse_mode: "Markdown" }),
      });
    } catch (err) {
      console.error("Launch Telegram send failed:", err);
    }
  }

  return {
    statusCode: 200,
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify({ ok: true }),
  };
}
