// Public endpoint for the Merchants statement analyzer.
//
// Three-step flow (all POST, keeps every request under the ~6MB function
// body limit even for multi-page phone-photo uploads):
//   1. action=create   (JSON)   → validates the lead, creates the record,
//                                 returns { id, token } for the uploads
//   2. action=upload   (binary) → one statement page per request
//   3. action=finalize (JSON)   → notifies Nick, queues the Claude
//                                 extraction in the background function
//
// The Anthropic API is only ever called server-side (background function);
// the key never reaches the browser.
import {
  getMerchantStore, loadSubmission, saveSubmission, json,
  submissionToken, verifySubmissionToken, clientIpFromRequest,
  notifyTelegram, notifyEmail, escapeHtml,
  ALLOWED_FILE_TYPES, MAX_FILE_BYTES, MAX_FILES,
} from "./lib/merchants.mjs";
import {
  EMAIL_RE, URL_IN_NAME_RE, MIN_FORM_ELAPSED_MS, DISPOSABLE_DOMAINS,
  emailDomain, checkRateLimit, verifyTurnstile,
} from "./lib/launch-spam.mjs";

const VOLUME_RANGES = new Set([
  "under_10k", "10k_25k", "25k_50k", "50k_100k", "100k_250k", "over_250k", "not_sure",
]);

export default async (req, context) => {
  if (req.method !== "POST") {
    return json({ ok: false, reason: "method not allowed" }, 405);
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "create";

  try {
    if (action === "create") return await handleCreate(req, context);
    if (action === "upload") return await handleUpload(req, url);
    if (action === "finalize") return await handleFinalize(req, url);
    return json({ ok: false, reason: "unknown action" }, 400);
  } catch (err) {
    console.error("merchant-analyzer error:", err);
    return json({ ok: false, reason: "server error" }, 500);
  }
};

async function handleCreate(req, context) {
  let data;
  try {
    data = await req.json();
  } catch {
    return json({ ok: false, reason: "invalid json" }, 400);
  }

  const ip = clientIpFromRequest(req, context);
  const ua = (req.headers.get("user-agent") || "unknown").slice(0, 500);

  const business = String(data.business || "").trim().slice(0, 200);
  const name = String(data.name || "").trim().slice(0, 120);
  const email = String(data.email || "").trim().toLowerCase().slice(0, 200);
  const phone = String(data.phone || "").trim().slice(0, 30);
  const volume = String(data.volume || "").trim();

  // ── Bot protection (mirrors the Launch forms) ──
  if (data.botField && String(data.botField).trim() !== "") {
    console.log("MERCHANTS BOT BLOCKED (honeypot):", JSON.stringify({ ip, ua, email }));
    return json({ ok: false, reason: "invalid" }, 400);
  }
  const formElapsedMs = Number(data.formElapsedMs) || 0;
  if (formElapsedMs < MIN_FORM_ELAPSED_MS) {
    console.log("MERCHANTS BOT BLOCKED (time-trap):", JSON.stringify({ ip, ua, formElapsedMs }));
    return json({ ok: false, reason: "invalid" }, 400);
  }

  // ── Validation ──
  const errors = [];
  if (!business || business.length < 2) errors.push("business");
  if (!name || !/[a-zA-Z]{2,}/.test(name) || URL_IN_NAME_RE.test(name)) errors.push("name");
  if (!email || !EMAIL_RE.test(email)) errors.push("email");
  const phoneDigits = phone.replace(/\D/g, "");
  if (phoneDigits.length < 10 || phoneDigits.length > 15) errors.push("phone");
  if (!VOLUME_RANGES.has(volume)) errors.push("volume");
  if (errors.length) return json({ ok: false, reason: "validation", errors }, 400);

  if (DISPOSABLE_DOMAINS.has(emailDomain(email))) {
    console.log("MERCHANTS BOT BLOCKED (disposable email):", JSON.stringify({ ip, email }));
    return json({ ok: false, reason: "invalid" }, 400);
  }
  const rateLimit = await checkRateLimit(ip, { max: 4, storeName: "merchant-rate-limits" });
  if (!rateLimit.allowed) {
    console.log("MERCHANTS BOT BLOCKED (rate limit):", JSON.stringify({ ip, count: rateLimit.count }));
    return json({ ok: false, reason: "invalid" }, 400);
  }
  const turnstile = await verifyTurnstile(data.turnstileToken || "", ip);
  if (!turnstile.ok) {
    console.log("MERCHANTS BOT BLOCKED (turnstile):", JSON.stringify({ ip, reason: turnstile.reason }));
    return json({ ok: false, reason: "invalid" }, 400);
  }

  const id = crypto.randomUUID();
  const record = {
    id,
    created_at: new Date().toISOString(),
    status: "received",
    contact: { business, name, email, phone, volume },
    files: [],
    analysis: null,
    analysis_error: null,
    analysis_override: null,
    notes: "",
    ip,
    user_agent: ua,
  };
  await saveSubmission(getMerchantStore(), record);

  console.log("=== NEW MERCHANT ANALYZER SUBMISSION ===", JSON.stringify({ id, ip, business, email }));
  return json({ ok: true, id, token: submissionToken(id) });
}

async function handleUpload(req, url) {
  const id = url.searchParams.get("id") || "";
  const token = url.searchParams.get("token") || "";
  const index = Number(url.searchParams.get("index"));
  const name = (url.searchParams.get("name") || "statement").slice(0, 150);
  const type = req.headers.get("content-type") || "";

  if (!verifySubmissionToken(id, token)) return json({ ok: false, reason: "unauthorized" }, 401);
  if (!Number.isInteger(index) || index < 0 || index >= MAX_FILES) {
    return json({ ok: false, reason: "bad index" }, 400);
  }
  if (!ALLOWED_FILE_TYPES.has(type)) {
    return json({ ok: false, reason: "unsupported file type" }, 400);
  }

  const store = getMerchantStore();
  const record = await loadSubmission(store, id);
  if (!record || record.status !== "received") {
    return json({ ok: false, reason: "submission not open for uploads" }, 409);
  }

  const body = await req.arrayBuffer();
  if (!body.byteLength) return json({ ok: false, reason: "empty file" }, 400);
  if (body.byteLength > MAX_FILE_BYTES) {
    return json({ ok: false, reason: "file too large" }, 413);
  }

  await store.set(`files/${id}/${index}`, body);
  record.files = record.files.filter((f) => f.index !== index);
  record.files.push({ index, name, type, size: body.byteLength });
  record.files.sort((a, b) => a.index - b.index);
  await saveSubmission(store, record);

  return json({ ok: true });
}

async function handleFinalize(req, url) {
  let data;
  try {
    data = await req.json();
  } catch {
    return json({ ok: false, reason: "invalid json" }, 400);
  }
  const { id, token } = data;
  if (!verifySubmissionToken(id, token)) return json({ ok: false, reason: "unauthorized" }, 401);

  const store = getMerchantStore();
  const record = await loadSubmission(store, id);
  if (!record) return json({ ok: false, reason: "not found" }, 404);
  if (record.status !== "received") return json({ ok: true, already: true });
  if (!record.files.length) return json({ ok: false, reason: "no files uploaded" }, 400);

  record.status = "queued";
  await saveSubmission(store, record);

  // Notify on every new submission — the lead is captured regardless of
  // whether the automated extraction later succeeds.
  const c = record.contact;
  const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/Chicago" });
  await notifyTelegram(
    `💳 *Merchants — New Statement Analysis Request*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `🏢 *Business:* ${c.business}\n` +
    `👤 *Name:* ${c.name}\n` +
    `📧 *Email:* ${c.email}\n` +
    `📱 *Phone:* ${c.phone}\n` +
    `📊 *Monthly volume:* ${c.volume}\n` +
    `📄 *Pages uploaded:* ${record.files.length}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `⏰ ${timestamp}\n` +
    `Review: https://crownmerchantfinancial.com/merchants/review`
  );
  await notifyEmail(
    `New statement analysis request: ${c.business}`,
    `<p>New merchant statement submission.</p>
     <ul>
       <li><strong>Business:</strong> ${escapeHtml(c.business)}</li>
       <li><strong>Contact:</strong> ${escapeHtml(c.name)} &lt;${escapeHtml(c.email)}&gt; ${escapeHtml(c.phone)}</li>
       <li><strong>Monthly volume:</strong> ${escapeHtml(c.volume)}</li>
       <li><strong>Pages:</strong> ${record.files.length}</li>
     </ul>
     <p><a href="https://crownmerchantfinancial.com/merchants/review">Open the review page</a></p>`
  );

  // Kick off the extraction in the background function (15-minute limit
  // there vs ~26s here). Fire-and-return: the background endpoint replies
  // 202 immediately.
  try {
    await fetch(`${url.origin}/.netlify/functions/merchant-analyzer-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, token: submissionToken(id) }),
    });
  } catch (err) {
    console.error("Failed to queue background analysis:", err);
    record.status = "needs_manual";
    record.analysis_error = "could not queue automated analysis";
    await saveSubmission(store, record);
  }

  return json({ ok: true });
}
