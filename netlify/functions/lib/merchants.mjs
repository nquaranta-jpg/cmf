// Shared helpers for the Merchants statement analyzer.
//
// Storage: Netlify Blobs (already used for Launch rate limits). One store,
// "merchant-statements":
//   submissions/<id>.json  — submission record (contact info, file index,
//                            extracted analysis, review status)
//   files/<id>/<n>         — original uploaded statement pages (binary)
//
// Statements contain sensitive business financials, so nothing here ever
// serves a file or record without either the internal upload token (HMAC
// of the submission id) or the review password.
import { createHmac, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";
import Anthropic from "@anthropic-ai/sdk";

export const STORE_NAME = "merchant-statements";

// Fair-pricing benchmark: interchange + 0.30% + $0.10 per transaction.
export const FAIR_MARKUP_RATE = 0.003;
export const FAIR_MARKUP_PER_TXN = 0.1;
// "At or near" the benchmark = within 10% of the fair total.
export const FAIRLY_PRICED_TOLERANCE = 1.1;

export const ALLOWED_FILE_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
export const MAX_FILE_BYTES = 4.75 * 1024 * 1024; // per-request function limit is ~6MB
export const MAX_FILES = 12;

export function getMerchantStore() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

// ── Tokens & auth ──────────────────────────────────────────────────────

function signingSecret() {
  // The review password is the natural secret; fall back to keys that are
  // already set in Netlify so upload tokens work before it's configured.
  return (
    process.env.MERCHANTS_REVIEW_PASSWORD ||
    process.env.LAUNCH_SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_KEY ||
    "merchants-dev-secret"
  );
}

export function submissionToken(id) {
  return createHmac("sha256", signingSecret()).update(`merchant:${id}`).digest("hex");
}

export function verifySubmissionToken(id, token) {
  if (!id || !token || typeof token !== "string") return false;
  const expected = submissionToken(id);
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyReviewPassword(req) {
  const configured = process.env.MERCHANTS_REVIEW_PASSWORD;
  if (!configured) return { ok: false, reason: "MERCHANTS_REVIEW_PASSWORD is not set" };
  const provided = req.headers.get("x-review-key") || "";
  const a = Buffer.from(configured);
  const b = Buffer.from(provided);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad password" };
  }
  return { ok: true };
}

export function clientIpFromRequest(req, context) {
  return (
    context?.ip ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown"
  );
}

export function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

// ── Records ────────────────────────────────────────────────────────────

export async function loadSubmission(store, id) {
  if (!id || !/^[a-f0-9-]{36}$/.test(id)) return null;
  return store.get(`submissions/${id}.json`, { type: "json" });
}

export async function saveSubmission(store, record) {
  await store.setJSON(`submissions/${record.id}.json`, record);
}

// ── Claude extraction ──────────────────────────────────────────────────

const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "merchant_name", "statement_month", "processor_name_if_visible",
    "total_card_volume", "total_transaction_count", "total_fees_charged",
    "fee_line_items", "effective_rate", "estimated_interchange_cost",
    "estimated_fair_total_cost", "estimated_annual_savings", "red_flags",
    "confidence", "confidence_note", "fairly_priced",
  ],
  properties: {
    merchant_name: { type: ["string", "null"] },
    statement_month: { type: ["string", "null"] },
    processor_name_if_visible: { type: ["string", "null"] },
    total_card_volume: { type: ["number", "null"] },
    total_transaction_count: { type: ["integer", "null"] },
    total_fees_charged: { type: ["number", "null"] },
    fee_line_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "amount"],
        properties: { label: { type: "string" }, amount: { type: "number" } },
      },
    },
    effective_rate: { type: ["number", "null"] },
    estimated_interchange_cost: { type: ["number", "null"] },
    estimated_fair_total_cost: { type: ["number", "null"] },
    estimated_annual_savings: { type: ["number", "null"] },
    red_flags: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    confidence_note: { type: "string" },
    fairly_priced: { type: "boolean" },
  },
};

const EXTRACTION_PROMPT = `You are analyzing a merchant card-processing statement for a payments consultant. The pages are attached (PDF pages or phone photos, possibly blurry or out of order).

Extract and compute:
- merchant_name, statement_month, processor_name_if_visible: read from the statement, null if not visible.
- total_card_volume: total dollars of card sales processed in the statement period.
- total_transaction_count: total number of transactions.
- total_fees_charged: ALL processing costs charged to the merchant on this statement, in dollars. Include discount fees, interchange charges, per-item fees, monthly fees, statement fees, PCI fees, equipment fees, and any other charges.
- fee_line_items: every fee line you can actually read, as { label, amount }.
- effective_rate: total_fees_charged / total_card_volume, as a percentage (e.g. 3.42 for 3.42%).
- estimated_interchange_cost: your best estimate of true interchange plus network pass-through cost for this volume and card mix, stated conservatively (when unsure, estimate interchange HIGHER rather than lower, which shrinks the apparent markup).
- estimated_fair_total_cost: interchange plus a fair markup, using interchange plus 0.30% of volume plus $0.10 per transaction as the fair-pricing benchmark.
- estimated_annual_savings: (total_fees_charged - estimated_fair_total_cost) * 12, floored at zero.
- red_flags: strings naming padded or junk items you see, e.g. PCI non-compliance fees, monthly minimums, batch fees, statement fees, tiered/qualified pricing language, annual fees, "non-qualified" surcharges. Write each as a short plain sentence a business owner can read. Never use em dashes; use periods or commas.
- confidence: high / medium / low. Use confidence_note to say what you could not read or had to infer.
- fairly_priced: true if the effective rate is already at or near the fair benchmark.

BE CONSERVATIVE. This analysis is shown to a real business owner. When a number is ambiguous or partially legible, choose the reading that produces the SMALLER savings estimate, and lower the confidence rating. An overstated savings number is the worst possible failure; an understated one is acceptable. If you cannot find total volume or total fees at all, return null for those fields and set confidence to low.`;

function mediaBlock(file, base64) {
  if (file.type === "application/pdf") {
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: base64 },
    };
  }
  return {
    type: "image",
    source: { type: "base64", media_type: file.type, data: base64 },
  };
}

// Recompute the derived numbers from the extracted inputs so arithmetic is
// deterministic and the conservative benchmark is applied exactly.
export function recomputeAnalysis(a) {
  const out = { ...a };
  const V = typeof a.total_card_volume === "number" && a.total_card_volume > 0 ? a.total_card_volume : null;
  const N = typeof a.total_transaction_count === "number" && a.total_transaction_count > 0 ? a.total_transaction_count : null;
  const F = typeof a.total_fees_charged === "number" && a.total_fees_charged >= 0 ? a.total_fees_charged : null;
  const I = typeof a.estimated_interchange_cost === "number" && a.estimated_interchange_cost >= 0 ? a.estimated_interchange_cost : null;

  if (V && F !== null) out.effective_rate = round2((F / V) * 100);
  if (V && N && I !== null) {
    out.estimated_fair_total_cost = round2(I + V * FAIR_MARKUP_RATE + N * FAIR_MARKUP_PER_TXN);
  }
  if (F !== null && typeof out.estimated_fair_total_cost === "number") {
    out.estimated_annual_savings = round2(Math.max(0, (F - out.estimated_fair_total_cost) * 12));
    out.fairly_priced = F <= out.estimated_fair_total_cost * FAIRLY_PRICED_TOLERANCE;
  }
  return out;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

export async function runExtraction(store, record) {
  const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY

  const content = [];
  for (const file of record.files) {
    const buf = await store.get(`files/${record.id}/${file.index}`, { type: "arrayBuffer" });
    if (!buf) throw new Error(`missing uploaded file ${file.index}`);
    content.push(mediaBlock(file, Buffer.from(buf).toString("base64")));
  }
  content.push({ type: "text", text: EXTRACTION_PROMPT });

  const response = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { format: { type: "json_schema", schema: EXTRACTION_SCHEMA } },
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("model declined the request");
  }
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error("no text block in model response");

  // Structured outputs guarantee valid JSON, but strip fences defensively.
  const raw = textBlock.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const extracted = JSON.parse(raw);
  return recomputeAnalysis(extracted);
}

// ── Notifications ──────────────────────────────────────────────────────

export async function notifyTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_GROUP_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: "Markdown" }),
    });
  } catch (err) {
    console.error("Merchants Telegram send failed:", err);
  }
}

// Email notification. Tries Resend first (RESEND_API_KEY is already set in
// this site's Netlify env), then Brevo (the provider the repo's
// email-campaigns tooling uses). Silently skipped when neither key nor a
// recipient is configured — Telegram still fires either way.
export async function notifyEmail(subject, html) {
  const to = process.env.MERCHANTS_NOTIFY_EMAIL || process.env.BACKUP_EMAIL;
  if (!to) return;
  const from = process.env.MERCHANTS_NOTIFY_FROM || "no-reply@crownmerchantfinancial.com";

  try {
    if (process.env.RESEND_API_KEY) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from: `CMF Merchants <${from}>`, to: [to], subject, html }),
      });
      if (!res.ok) console.error("Resend send failed:", res.status, await res.text());
      return;
    }
    if (process.env.BREVO_API_KEY) {
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: { name: "CMF Merchants", email: from },
          to: [{ email: to }],
          subject,
          htmlContent: html,
        }),
      });
      if (!res.ok) console.error("Brevo send failed:", res.status, await res.text());
    }
  } catch (err) {
    console.error("Merchants email send failed:", err);
  }
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
