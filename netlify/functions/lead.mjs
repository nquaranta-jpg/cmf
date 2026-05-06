import { getStore } from "@netlify/blobs";
import { getSupabase } from "./lib/supabase.mjs";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_GROUP_CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID; // fallback

const PRODUCT_LABELS = {
  "final-expense": "Final Expense",
  "term-life": "Term Life",
  "annuity": "Annuity",
  "iul": "Indexed Universal Life (IUL)",
  "not-sure": "General Inquiry",
  // Homepage forms send human-readable values
  "Final Expense": "Final Expense",
  "Term Life": "Term Life",
  "Annuity": "Annuity",
  "IUL": "Indexed Universal Life (IUL)",
  "Not sure": "General Inquiry",
};

// Bot protection thresholds + format checks
const MIN_FORM_ELAPSED_MS = 1500; // client enforces 2000; allow some skew
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_IN_NAME_RE = /https?:\/\/|www\.|\.(com|net|org|biz|info|ru|cn|io|xyz)\b/i;

// Per-IP rate limit
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// Disposable / throwaway email domains. Top ~100 by abuse frequency.
// Real users virtually never use these; bots and spam scripts do.
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "mailinator.net", "mailinator.org",
  "10minutemail.com", "10minutemail.net", "10minutemail.org",
  "guerrillamail.com", "guerrillamail.net", "guerrillamail.org", "guerrillamail.biz", "guerrillamail.de",
  "sharklasers.com", "grr.la", "guerrillamailblock.com",
  "tempmail.com", "tempmail.org", "tempmail.net", "tempmail.us.com", "tempmail.email",
  "temp-mail.org", "temp-mail.com", "temp-mail.io", "temp-mail.ru",
  "tempr.email", "tempinbox.com", "tempmailaddress.com", "tempmailo.com",
  "yopmail.com", "yopmail.fr", "yopmail.net",
  "throwawaymail.com", "throwawaymail.pp.ua", "throwam.com",
  "dispostable.com", "dispomail.eu", "dispomail.com",
  "fakeinbox.com", "fakemailgenerator.com", "fakemail.net",
  "mailnesia.com", "mailnesia.net",
  "getnada.com", "getairmail.com", "nada.email",
  "maildrop.cc", "mailcatch.com",
  "mintemail.com", "mtmdev.com", "mvrht.com", "mvrht.net",
  "trashmail.com", "trashmail.net", "trashmail.de", "trashmail.io", "trashmail.ws",
  "spambox.us", "spamgourmet.com", "spamthis.co.uk", "spamex.com",
  "jetable.org", "sneakemail.com", "emailondeck.com",
  "anonbox.net", "deadaddress.com", "easytrashmail.com",
  "harakirimail.com", "mailtemp.info", "mohmal.com", "moakt.com", "moakt.cc",
  "cs.email", "mail-temp.com", "mail-temporaire.fr", "mail.tm",
  "instaaddr.com", "inboxalias.com", "inboxbear.com",
  "nadamail.com", "mytemp.email",
  "tmpmail.org", "tmpmail.net", "tmpeml.com", "tmpmail.email", "tmpbox.net",
  "33mail.com", "altmails.com", "6paq.com",
  "temporary-mail.net", "crazymailing.com",
  "emailfake.com", "emailtemporanee.com",
  "dropjar.com", "zoemail.org",
  "byom.de", "smashmail.de", "smellfear.com",
  "burnermail.io", "tempmailgen.com",
  // RFC 2606 reserved test/example domains — bots use these
  "example.com", "example.org", "example.net", "test.com", "test.org",
]);

function reject(reason, body) {
  return {
    statusCode: 400,
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(body || { ok: false, reason }),
  };
}

// Check if the lead claims to come from a paid Google Ads click but
// has no gclid. Real Google Ads clicks always carry gclid via auto-
// tagging; spoofed UTMs from bots almost never do.
function isPaidGoogleWithoutGclid(utm_source, utm_medium, gclid) {
  const src = (utm_source || "").trim().toLowerCase();
  const med = (utm_medium || "").trim().toLowerCase();
  const isGoogleSrc = src === "google" || src === "googleads" || src === "adwords";
  const isPaidMed = med === "cpc" || med === "ppc" || med === "paid" || med === "paidsearch" || med === "paid-search";
  return isGoogleSrc && isPaidMed && !(gclid && String(gclid).trim());
}

function emailDomain(email) {
  if (!email || typeof email !== "string") return "";
  const at = email.lastIndexOf("@");
  if (at < 0) return "";
  return email.slice(at + 1).trim().toLowerCase();
}

// Per-IP rate limiter using Netlify Blobs. Fails open on errors so a
// blob outage doesn't break form submission — Turnstile remains the
// primary defense.
async function checkRateLimit(ip) {
  if (!ip || ip === "unknown") return { allowed: true, count: 0 };
  try {
    const store = getStore({ name: "lead-rate-limits", consistency: "strong" });
    const key = `ip:${ip.replace(/[^a-zA-Z0-9.:]/g, "_")}`;
    const entry = await store.get(key, { type: "json" });
    const now = Date.now();

    if (!entry || (now - entry.windowStart) > RATE_LIMIT_WINDOW_MS) {
      await store.setJSON(key, { count: 1, windowStart: now });
      return { allowed: true, count: 1 };
    }
    if (entry.count >= RATE_LIMIT_MAX) {
      return { allowed: false, count: entry.count };
    }
    await store.setJSON(key, { count: entry.count + 1, windowStart: entry.windowStart });
    return { allowed: true, count: entry.count + 1 };
  } catch (err) {
    console.error("Rate limit error (failing open):", err);
    return { allowed: true, count: 0 };
  }
}

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const ip = (event.headers["x-forwarded-for"] || "").split(",")[0].trim()
    || event.headers["client-ip"]
    || "unknown";
  const ua = event.headers["user-agent"] || "unknown";

  const { name, email, phone, ageRange, coverageAmount, timeline, productInterest, utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid } = data;

  // ── Bot protection: honeypot ──
  // If the hidden bot-field has any value, it was filled by a bot.
  if (data.botField && String(data.botField).trim() !== "") {
    console.log("BOT BLOCKED (honeypot):", JSON.stringify({ ip, ua, botField: data.botField, name, email, phone }));
    return reject("invalid");
  }

  // ── Bot protection: time-trap ──
  // Real users take >= 1.5s between first interaction and submit. Bots
  // fire instantly. Missing/zero formElapsedMs also fails (no focus
  // events were ever triggered).
  const formElapsedMs = Number(data.formElapsedMs) || 0;
  if (formElapsedMs < MIN_FORM_ELAPSED_MS) {
    console.log("BOT BLOCKED (time-trap):", JSON.stringify({ ip, ua, formElapsedMs, name, email, phone }));
    return reject("invalid");
  }

  // ── Format validation ──
  // Run before Turnstile so real users with typos get a useful error
  // instead of a generic "security check" message, and we don't burn
  // a Turnstile siteverify call on garbage data.
  const errors = [];
  if (!name || typeof name !== "string" || !/[a-zA-Z]{2,}/.test(name) || URL_IN_NAME_RE.test(name)) {
    errors.push("name");
  }
  if (!email || typeof email !== "string" || !EMAIL_RE.test(email)) {
    errors.push("email");
  }
  const phoneDigits = (phone || "").replace(/\D/g, "");
  if (phoneDigits.length < 10 || phoneDigits.length > 15) {
    errors.push("phone");
  }
  if (errors.length) {
    console.log("VALIDATION FAILED:", JSON.stringify({ ip, ua, errors, name, email, phone }));
    return reject("validation", { ok: false, errors });
  }

  // ── Bot protection: paid Google traffic must carry gclid ──
  // Real Google Ads clicks auto-tag a gclid. Bots that fake
  // utm_source=google&utm_medium=cpc almost never have one because
  // they didn't actually click an ad — they just spoofed the UTMs.
  if (isPaidGoogleWithoutGclid(utm_source, utm_medium, gclid)) {
    console.log("BOT BLOCKED (paid Google no gclid):", JSON.stringify({ ip, ua, utm_source, utm_medium, name, email, phone }));
    return reject("invalid");
  }

  // ── Bot protection: disposable email domain ──
  const domain = emailDomain(email);
  if (domain && DISPOSABLE_DOMAINS.has(domain)) {
    console.log("BOT BLOCKED (disposable email):", JSON.stringify({ ip, ua, domain, name, email, phone }));
    return reject("invalid");
  }

  // ── Bot protection: per-IP rate limit ──
  // Caps at 3 submissions per IP per hour. Even if a bot solves
  // Turnstile once, they can't carpet-bomb. Real households share IPs
  // but rarely submit 4+ insurance leads in an hour from one address.
  const rateLimit = await checkRateLimit(ip);
  if (!rateLimit.allowed) {
    console.log("BOT BLOCKED (rate limit):", JSON.stringify({ ip, ua, count: rateLimit.count, name, email, phone }));
    return reject("invalid");
  }

  // ── Bot protection: Cloudflare Turnstile ──
  // Active when TURNSTILE_SECRET_KEY is set in Netlify env. Verifies
  // the token the client got from the Turnstile widget. Fails closed
  // — if Cloudflare API is unreachable, we reject (better to lose a
  // few real submissions than let bots through).
  const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;
  if (turnstileSecret) {
    if (!data.turnstileToken) {
      console.log("BOT BLOCKED (turnstile missing):", JSON.stringify({ ip, ua, name, email }));
      return reject("invalid");
    }
    try {
      const verifyRes = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: turnstileSecret,
          response: data.turnstileToken,
          remoteip: ip,
        }),
      });
      const verifyJson = await verifyRes.json();
      if (!verifyJson.success) {
        console.log("BOT BLOCKED (turnstile failed):", JSON.stringify({ ip, ua, errors: verifyJson["error-codes"], name, email }));
        return reject("invalid");
      }
    } catch (err) {
      console.error("Turnstile verify error:", err);
      return reject("invalid");
    }
  }

  const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/Chicago" });
  const productLabel = PRODUCT_LABELS[productInterest] || "Final Expense";

  console.log("=== NEW CMF LEAD ===", JSON.stringify({ ip, name, email, phone, ageRange, coverageAmount, timeline, productInterest, utm_source, utm_medium, utm_campaign, timestamp }));

  const timelineLabels = { asap: "ASAP", "30days": "Within 30 days", "just-looking": "Just looking" };
  const timelineLabel = timelineLabels[timeline] || timeline || "—";

  // ── 1. Insert lead into Supabase ──
  let leadId = null;
  const supabase = getSupabase();
  try {
    const insertData = {
      name,
      email,
      phone,
      age_range: ageRange,
      coverage_amount: coverageAmount ? Number(coverageAmount) : null,
      timeline,
      product_interest: productInterest || "final-expense",
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      utm_term,
      gclid,
      status: "unclaimed",
      escalation_deadline: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };

    const { data: lead, error } = await supabase.from("leads").insert(insertData).select("id").single();

    if (error) {
      console.error("Supabase insert error:", error);
    } else {
      leadId = lead.id;
      console.log("Lead saved to Supabase:", leadId);
    }
  } catch (err) {
    console.error("Supabase error:", err);
  }

  // ── 2. Telegram message with CLAIM button ──
  const chatId = TELEGRAM_GROUP_CHAT_ID || TELEGRAM_CHAT_ID;

  const telegramMessage =
    `🔔 *New CMF ${productLabel} Lead*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `📋 *Product:* ${productLabel}\n` +
    `👤 *Name:* ${name || "—"}\n` +
    `📧 *Email:* ${email || "—"}\n` +
    `📱 *Phone:* ${phone || "—"}\n` +
    `🎂 *Age Range:* ${ageRange || "—"}\n` +
    (coverageAmount ? `💰 *Coverage:* $${Number(coverageAmount).toLocaleString()}\n` : "") +
    `⏱️ *Timeline:* ${timelineLabel}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `📍 *Source:* ${utm_source || "direct"} / ${utm_medium || "none"}\n` +
    `📢 *Campaign:* ${utm_campaign || "—"}\n` +
    `⏰ *Time:* ${timestamp}`;

  const telegramPayload = {
    chat_id: chatId,
    text: telegramMessage,
    parse_mode: "Markdown",
  };

  if (leadId) {
    telegramPayload.reply_markup = {
      inline_keyboard: [[
        { text: "🔥 CLAIM THIS LEAD", callback_data: `claim:${leadId}` }
      ]]
    };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(telegramPayload),
    });
    const result = await res.json();
    if (!result.ok) {
      console.error("Telegram API error:", result);
    } else if (leadId && result.result) {
      const msgId = result.result.message_id;
      const msgChatId = result.result.chat.id;
      await supabase.from("leads").update({
        telegram_message_id: msgId,
        telegram_chat_id: msgChatId,
      }).eq("id", leadId);
      console.log("Stored telegram message_id:", msgId);
    }
  } catch (err) {
    console.error("Telegram send failed:", err);
  }

  return {
    statusCode: 200,
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify({ ok: true }),
  };
}
