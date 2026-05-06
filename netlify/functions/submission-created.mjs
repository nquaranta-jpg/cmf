// Netlify auto-triggers this function when any form submission is created.
// Function name "submission-created" is a Netlify convention — no config needed.
// This is the fallback path (used when JS fails / is disabled). The primary
// path goes through /.netlify/functions/lead.

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_IN_NAME_RE = /https?:\/\/|www\.|\.(com|net|org|biz|info|ru|cn|io|xyz)\b/i;

export async function handler(event) {
  const { payload } = JSON.parse(event.body);
  const { name, email, phone, ageRange, coverageAmount, productInterest } = payload.data;

  // ── Bot protection: honeypot (defense in depth) ──
  // Netlify already filters submissions where `bot-field` is filled
  // (data-netlify-honeypot attribute), but verify here too.
  const botField = payload.data["bot-field"];
  if (botField && String(botField).trim() !== "") {
    console.log("BOT BLOCKED (honeypot fallback):", JSON.stringify({ botField, name, email, phone }));
    return { statusCode: 200, body: "OK (honeypot)" };
  }

  // ── Format validation ──
  const errors = [];
  if (!name || !/[a-zA-Z]{2,}/.test(name) || URL_IN_NAME_RE.test(name)) errors.push("name");
  if (!email || !EMAIL_RE.test(email)) errors.push("email");
  const phoneDigits = (phone || "").replace(/\D/g, "");
  if (phoneDigits.length < 10 || phoneDigits.length > 15) errors.push("phone");
  if (errors.length) {
    console.log("VALIDATION FAILED (fallback):", JSON.stringify({ errors, name, email, phone }));
    return { statusCode: 200, body: "OK (validation failed)" };
  }

  const productLabels = { "final-expense": "Final Expense", "term-life": "Term Life", "annuity": "Annuity", "iul": "IUL", "not-sure": "General Inquiry" };
  const productLabel = productLabels[productInterest] || "General";

  const message =
    `🔔 *New CMF ${productLabel} Lead (Fallback)*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `📋 *Product:* ${productLabel}\n` +
    `👤 *Name:* ${name || "—"}\n` +
    `📧 *Email:* ${email || "—"}\n` +
    `📱 *Phone:* ${phone || "—"}\n` +
    `🎂 *Age Range:* ${ageRange || "—"}\n` +
    (coverageAmount ? `💰 *Coverage:* $${Number(coverageAmount).toLocaleString()}\n` : "") +
    `━━━━━━━━━━━━━━━━━━\n` +
    `📍 *Source:* Netlify Forms Fallback\n` +
    `⏰ *Time:* ${new Date().toLocaleString("en-US", { timeZone: "America/Chicago" })}`;

  if (!TELEGRAM_CHAT_ID) {
    console.error("TELEGRAM_CHAT_ID env var not set. Lead received but not forwarded:", payload.data);
    return { statusCode: 200, body: "OK (no chat ID configured)" };
  }

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: "Markdown",
        }),
      }
    );

    const result = await res.json();

    if (!result.ok) {
      console.error("Telegram API error:", result);
    }

    return { statusCode: 200, body: "OK" };
  } catch (err) {
    console.error("Failed to send Telegram notification:", err);
    return { statusCode: 200, body: "OK (telegram failed)" };
  }
}
