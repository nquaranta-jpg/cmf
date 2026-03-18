const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const BACKUP_EMAIL = process.env.BACKUP_EMAIL;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

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

  const { name, email, phone, ageRange, coverageAmount, utm_source, utm_medium, utm_campaign, utm_content, utm_term } = data;
  const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/Chicago" });

  console.log("=== NEW CMF LEAD ===", JSON.stringify({ name, email, phone, ageRange, coverageAmount, utm_source, utm_medium, utm_campaign, timestamp }));

  const telegramMessage =
    `🔔 *New CMF Final Expense Lead*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `👤 *Name:* ${name || "—"}\n` +
    `📧 *Email:* ${email || "—"}\n` +
    `📱 *Phone:* ${phone || "—"}\n` +
    `🎂 *Age Range:* ${ageRange || "—"}\n` +
    `💰 *Coverage:* $${coverageAmount ? Number(coverageAmount).toLocaleString() : "—"}\n` +
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
  ]);

  const telegram = results[0];
  const emailResult = results[1];

  if (telegram.status === "rejected") console.error("Telegram failed:", telegram.reason);
  if (emailResult.status === "rejected") console.error("Email failed:", emailResult.reason);

  return {
    statusCode: 200,
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify({ ok: true }),
  };
}
