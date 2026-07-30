// Receives a completed agent onboarding packet (PDF, base64) from
// /onboarding and emails it via Resend. The PDF contains SSN/banking
// details, so nothing is persisted here — the email is the only copy.

const NOTIFY_TO =
  process.env.ONBOARDING_NOTIFY_EMAIL || "nquaranta@crownmerchantfinancial.com";
const FROM = process.env.ONBOARDING_NOTIFY_FROM || "no-reply@crownmerchantfinancial.com";

// Base64 of ~4MB PDF ≈ 5.4MB; Netlify sync functions cap bodies at 6MB.
const MAX_PDF_B64 = 5_600_000;

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid json" });
  }

  // Honeypot: real form sends an empty "website"
  if (body.website) return json(200, { ok: true });

  const name = String(body.name || "").slice(0, 120).trim();
  const email = String(body.email || "").slice(0, 200).trim();
  const phone = String(body.phone || "").slice(0, 40).trim();
  const npn = String(body.npn || "").slice(0, 40).trim();
  const pdf = String(body.pdf || "");

  if (!name || !pdf) return json(400, { error: "missing name or pdf" });
  if (pdf.length > MAX_PDF_B64) return json(413, { error: "pdf too large" });
  if (!/^[A-Za-z0-9+/=]+$/.test(pdf)) return json(400, { error: "bad pdf encoding" });

  if (!process.env.RESEND_API_KEY) {
    console.error("onboarding-submit: RESEND_API_KEY not configured");
    return json(500, { error: "email not configured" });
  }

  const filename = /^[\w.-]+\.pdf$/i.test(String(body.filename || ""))
    ? body.filename
    : "CMF-Onboarding-Packet.pdf";

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const html = `
    <h2>New agent onboarding packet</h2>
    <p><b>${esc(name)}</b> completed the agent onboarding packet on crownmerchantfinancial.com.</p>
    <ul>
      <li>Email: ${esc(email) || "—"}</li>
      <li>Phone: ${esc(phone) || "—"}</li>
      <li>NPN: ${esc(npn) || "—"}</li>
      <li>Documents: ${body.docsLater ? "⚠ agent will send some documents separately" : "included in PDF"}</li>
    </ul>
    <p>The completed packet is attached. Review it, then forward it to your Royalty Financial Group upline.</p>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `CMF Onboarding <${FROM}>`,
        to: [NOTIFY_TO],
        reply_to: email || undefined,
        subject: `Onboarding packet: ${name}${npn ? ` (NPN ${npn})` : ""}`,
        html,
        attachments: [{ filename, content: pdf }],
      }),
    });
    if (!res.ok) {
      console.error("onboarding-submit: Resend failed", res.status, await res.text());
      return json(502, { error: "email send failed" });
    }
  } catch (err) {
    console.error("onboarding-submit:", err);
    return json(502, { error: "email send failed" });
  }

  return json(200, { ok: true });
};
