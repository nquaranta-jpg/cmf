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
};

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

  const { name, email, phone, ageRange, coverageAmount, timeline, productInterest, utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid } = data;
  const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/Chicago" });
  const productLabel = PRODUCT_LABELS[productInterest] || "Final Expense";

  console.log("=== NEW CMF LEAD ===", JSON.stringify({ name, email, phone, ageRange, coverageAmount, timeline, productInterest, utm_source, utm_medium, utm_campaign, timestamp }));

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
