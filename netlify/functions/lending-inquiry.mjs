// Hard money lending deal inquiries from /lending.
//
// Notification-only by design: inquiries go to Telegram (primary) and email
// (Resend, falling back to BACKUP_EMAIL as recipient) — no database table,
// mirroring how the old merchants desk worked. Deliberately separate from
// lead.mjs so deal inquiries never enter the insurance-lead "CLAIM" flow.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const LOAN_TYPES = {
  fix_flip: "Fix & flip",
  bridge: "Bridge",
  construction: "New construction",
  other: "Other / not sure",
};

const TIMELINES = {
  under_2_weeks: "Under 2 weeks",
  "2_4_weeks": "2–4 weeks",
  "1_3_months": "1–3 months",
  exploring: "Just lining up capital",
};

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors(), body: "Method not allowed" };
  }

  let data;
  try { data = JSON.parse(event.body || "{}"); } catch { data = {}; }

  // Honeypot: pretend success so bots don't retry.
  if ((data["bot-field"] || "").toString().trim()) {
    return { statusCode: 200, headers: cors(), body: JSON.stringify({ ok: true }) };
  }

  const name = clean(data.name, 120);
  const company = clean(data.company, 120);
  const email = clean(data.email, 200).toLowerCase();
  const phone = clean(data.phone, 40);
  const loanType = LOAN_TYPES[data.loan_type] || clean(data.loan_type, 40) || "—";
  const location = clean(data.location, 160);
  const timeline = TIMELINES[data.timeline] || clean(data.timeline, 40) || "—";
  const details = clean(data.details, 2000);

  if (!name) {
    return { statusCode: 400, headers: cors(), body: JSON.stringify({ ok: false, reason: "name" }) };
  }
  if (!EMAIL_RE.test(email)) {
    return { statusCode: 400, headers: cors(), body: JSON.stringify({ ok: false, reason: "email" }) };
  }

  const lines = [
    `*New hard money inquiry* 🏗`,
    ``,
    `*Name:* ${name}${company ? ` (${company})` : ""}`,
    `*Email:* ${email}`,
    `*Phone:* ${phone || "—"}`,
    `*Loan type:* ${loanType}`,
    `*Property:* ${location || "—"}`,
    `*Timeline:* ${timeline}`,
    details ? `*Deal:* ${details}` : null,
  ].filter((l) => l !== null);

  await Promise.all([
    notifyTelegram(lines.join("\n")),
    notifyEmail(
      `Hard money inquiry — ${name}${location ? ` (${location})` : ""}`,
      `<h2>New hard money inquiry</h2>
       <p><strong>Name:</strong> ${esc(name)}${company ? ` (${esc(company)})` : ""}<br>
       <strong>Email:</strong> ${esc(email)}<br>
       <strong>Phone:</strong> ${esc(phone) || "—"}<br>
       <strong>Loan type:</strong> ${esc(loanType)}<br>
       <strong>Property:</strong> ${esc(location) || "—"}<br>
       <strong>Timeline:</strong> ${esc(timeline)}</p>
       ${details ? `<p><strong>Deal:</strong><br>${esc(details).replace(/\n/g, "<br>")}</p>` : ""}`
    ),
  ]);

  return { statusCode: 200, headers: cors(), body: JSON.stringify({ ok: true }) };
}

function clean(v, max) {
  return (v ?? "").toString().trim().slice(0, max);
}

function cors() {
  return { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
}

async function notifyTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_GROUP_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: "Markdown" }),
    });
    if (!res.ok) console.error("Lending Telegram send failed:", res.status, await res.text());
  } catch (err) {
    console.error("Lending Telegram send failed:", err);
  }
}

async function notifyEmail(subject, html) {
  const to = process.env.LENDING_NOTIFY_EMAIL || process.env.BACKUP_EMAIL;
  if (!to || !process.env.RESEND_API_KEY) return;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "CMF Lending <no-reply@crownmerchantfinancial.com>",
        to: [to],
        subject,
        html,
      }),
    });
    if (!res.ok) console.error("Lending Resend send failed:", res.status, await res.text());
  } catch (err) {
    console.error("Lending email send failed:", err);
  }
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
