const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const BACKUP_EMAIL = process.env.BACKUP_EMAIL;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const ALERT_PHONE_NUMBER = process.env.ALERT_PHONE_NUMBER; // your cell for lead alerts

// Helper to send SMS via Twilio REST API
async function sendSMS(to, body) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const params = new URLSearchParams({ To: to, From: TWILIO_PHONE_NUMBER, Body: body });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const result = await res.json();
  if (!res.ok) console.error("Twilio SMS error:", result);
  return { ok: res.ok, sid: result.sid };
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

  const { name, email, phone, ageRange, coverageAmount, timeline, utm_source, utm_medium, utm_campaign, utm_content, utm_term } = data;
  const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/Chicago" });

  console.log("=== NEW CMF LEAD ===", JSON.stringify({ name, email, phone, ageRange, coverageAmount, timeline, utm_source, utm_medium, utm_campaign, timestamp }));

  const timelineLabels = { asap: "ASAP", "30days": "Within 30 days", "just-looking": "Just looking" };
  const timelineLabel = timelineLabels[timeline] || timeline || "—";

  const telegramMessage =
    `🔔 *New CMF Final Expense Lead*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `👤 *Name:* ${name || "—"}\n` +
    `📧 *Email:* ${email || "—"}\n` +
    `📱 *Phone:* ${phone || "—"}\n` +
    `🎂 *Age Range:* ${ageRange || "—"}\n` +
    `💰 *Coverage:* $${coverageAmount ? Number(coverageAmount).toLocaleString() : "—"}\n` +
    `⏱️ *Timeline:* ${timelineLabel}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `📍 *Source:* ${utm_source || "direct"} / ${utm_medium || "none"}\n` +
    `📢 *Campaign:* ${utm_campaign || "—"}\n` +
    `⏰ *Time:* ${timestamp}`;

  const results = await Promise.allSettled([
    // 1. Telegram (primary)
    fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: telegramMessage,
        parse_mode: "Markdown",
      }),
    }).then(async (res) => {
      const result = await res.json();
      if (!result.ok) console.error("Telegram API error:", result);
      return { channel: "telegram", ok: result.ok };
    }),

    // 2. Email backup via Resend
    RESEND_API_KEY
      ? fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            from: "CMF Leads <onboarding@resend.dev>",
            to: [BACKUP_EMAIL],
            subject: `New Final Expense Lead: ${name || "Unknown"} — CMF`,
            html: `
              <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px;background:#f8fafc;border-radius:12px;">
                <h2 style="margin:0 0 16px;color:#0a1628;">New Final Expense Lead</h2>
                <table style="width:100%;border-collapse:collapse;">
                  <tr><td style="padding:8px 0;color:#64748b;width:100px;">Name</td><td style="padding:8px 0;color:#0a1628;font-weight:600;">${name || "—"}</td></tr>
                  <tr><td style="padding:8px 0;color:#64748b;">Email</td><td style="padding:8px 0;color:#0a1628;font-weight:600;">${email || "—"}</td></tr>
                  <tr><td style="padding:8px 0;color:#64748b;">Phone</td><td style="padding:8px 0;color:#0a1628;font-weight:600;">${phone || "—"}</td></tr>
                  <tr><td style="padding:8px 0;color:#64748b;">Age Range</td><td style="padding:8px 0;color:#0a1628;font-weight:600;">${ageRange || "—"}</td></tr>
                  <tr><td style="padding:8px 0;color:#64748b;">Coverage</td><td style="padding:8px 0;color:#0a1628;font-weight:600;">$${coverageAmount ? Number(coverageAmount).toLocaleString() : "—"}</td></tr>
                  <tr><td style="padding:8px 0;color:#64748b;">Timeline</td><td style="padding:8px 0;color:#0a1628;font-weight:600;">${timelineLabel}</td></tr>
                </table>
                <hr style="margin:16px 0;border:none;border-top:1px solid #e2e8f0;">
                <p style="margin:0;color:#94a3b8;font-size:13px;">Source: ${utm_source || "direct"} / ${utm_medium || "none"} &bull; Campaign: ${utm_campaign || "—"} &bull; ${timestamp}</p>
              </div>
            `,
          }),
        }).then(async (res) => {
          const result = await res.json();
          if (!res.ok) console.error("Resend API error:", result);
          return { channel: "email", ok: res.ok };
        })
      : Promise.resolve({ channel: "email", ok: false, skipped: true }),

    // 3. SMS to prospect (instant auto-reply)
    TWILIO_ACCOUNT_SID && phone
      ? sendSMS(
          phone,
          `Hi ${name ? name.split(" ")[0] : "there"}, this is Nick from Crown Merchant Financial. I'll be calling you from (312) 203-8106 in the next few minutes to go over your coverage options. Please save this number so you know it's me!`
        ).then((r) => ({ channel: "sms-prospect", ...r }))
      : Promise.resolve({ channel: "sms-prospect", ok: false, skipped: true }),

    // 4. SMS alert to you (so you can call them back immediately)
    TWILIO_ACCOUNT_SID && ALERT_PHONE_NUMBER
      ? sendSMS(
          ALERT_PHONE_NUMBER,
          `🔥 NEW CMF LEAD\n${name || "Unknown"}\n📱 ${phone || "no phone"}\n📧 ${email || "no email"}\nAge: ${ageRange || "?"} | Coverage: $${coverageAmount ? Number(coverageAmount).toLocaleString() : "?"}\n⏱️ Timeline: ${timelineLabel}\nSource: ${utm_source || "direct"}\n⏰ ${timestamp}`
        ).then((r) => ({ channel: "sms-alert", ...r }))
      : Promise.resolve({ channel: "sms-alert", ok: false, skipped: true }),
  ]);

  const telegram = results[0];
  const emailResult = results[1];
  const smsProspect = results[2];
  const smsAlert = results[3];

  if (telegram.status === "rejected") console.error("Telegram failed:", telegram.reason);
  if (emailResult.status === "rejected") console.error("Email failed:", emailResult.reason);
  if (smsProspect.status === "rejected") console.error("SMS to prospect failed:", smsProspect.reason);
  if (smsAlert.status === "rejected") console.error("SMS alert failed:", smsAlert.reason);

  return {
    statusCode: 200,
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify({ ok: true }),
  };
}
