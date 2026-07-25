// Internal review API for the Merchants statement analyzer.
//
// Every call requires the shared review password in the x-review-key
// header, compared timing-safe against MERCHANTS_REVIEW_PASSWORD (Netlify
// env var — never in client code). Serves the review page at
// /merchants/review and the printable one-pager.
//
// Approval does NOT send anything to the prospect. It only marks the
// analysis approved so Nick can deliver it manually by email.
import {
  getMerchantStore, loadSubmission, saveSubmission, json,
  verifyReviewPassword, submissionToken, recomputeAnalysis,
} from "./lib/merchants.mjs";

const OVERRIDE_FIELDS = [
  "merchant_name", "statement_month", "processor_name_if_visible",
  "total_card_volume", "total_transaction_count", "total_fees_charged",
  "effective_rate", "estimated_interchange_cost", "estimated_fair_total_cost",
  "estimated_annual_savings", "fairly_priced", "red_flags",
];

export default async (req) => {
  const auth = verifyReviewPassword(req);
  if (!auth.ok) return json({ ok: false, reason: auth.reason }, 401);

  const url = new URL(req.url);
  const store = getMerchantStore();

  try {
    if (req.method === "GET") {
      const action = url.searchParams.get("action") || "list";
      if (action === "list") return await handleList(store);
      if (action === "get") return await handleGet(store, url);
      if (action === "file") return await handleFile(store, url);
      return json({ ok: false, reason: "unknown action" }, 400);
    }

    if (req.method === "POST") {
      let data;
      try {
        data = await req.json();
      } catch {
        return json({ ok: false, reason: "invalid json" }, 400);
      }
      const action = data.action;
      if (action === "login") return json({ ok: true });
      if (action === "update") return await handleUpdate(store, data);
      if (action === "approve") return await handleStatus(store, data, "approved");
      if (action === "reject") return await handleStatus(store, data, "rejected");
      if (action === "rerun") return await handleRerun(store, data, url);
      return json({ ok: false, reason: "unknown action" }, 400);
    }

    return json({ ok: false, reason: "method not allowed" }, 405);
  } catch (err) {
    console.error("merchant-review error:", err);
    return json({ ok: false, reason: "server error" }, 500);
  }
};

async function handleList(store) {
  const submissions = [];
  const { blobs } = await store.list({ prefix: "submissions/" });
  for (const blob of blobs) {
    const record = await store.get(blob.key, { type: "json" });
    if (!record) continue;
    submissions.push({
      id: record.id,
      created_at: record.created_at,
      status: record.status,
      business: record.contact?.business,
      name: record.contact?.name,
      email: record.contact?.email,
      volume: record.contact?.volume,
      pages: record.files?.length || 0,
      confidence: record.analysis?.confidence || null,
      effective_rate: record.analysis?.effective_rate ?? null,
      estimated_annual_savings: record.analysis?.estimated_annual_savings ?? null,
      fairly_priced: record.analysis?.fairly_priced ?? null,
    });
  }
  submissions.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return json({ ok: true, submissions });
}

async function handleGet(store, url) {
  const record = await loadSubmission(store, url.searchParams.get("id"));
  if (!record) return json({ ok: false, reason: "not found" }, 404);
  return json({ ok: true, submission: record });
}

async function handleFile(store, url) {
  const id = url.searchParams.get("id");
  const index = Number(url.searchParams.get("index"));
  const record = await loadSubmission(store, id);
  if (!record) return json({ ok: false, reason: "not found" }, 404);
  const file = record.files.find((f) => f.index === index);
  if (!file) return json({ ok: false, reason: "file not found" }, 404);
  const body = await store.get(`files/${id}/${index}`, { type: "arrayBuffer" });
  if (!body) return json({ ok: false, reason: "file missing" }, 404);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": file.type,
      "Content-Disposition": `inline; filename="${file.name.replace(/[^\w.\- ]/g, "_")}"`,
      "X-Robots-Tag": "noindex",
    },
  });
}

async function handleUpdate(store, data) {
  const record = await loadSubmission(store, data.id);
  if (!record) return json({ ok: false, reason: "not found" }, 404);

  if (data.overrides && typeof data.overrides === "object") {
    const overrides = {};
    for (const key of OVERRIDE_FIELDS) {
      if (data.overrides[key] !== undefined) overrides[key] = data.overrides[key];
    }
    // Re-derive the computed numbers from the edited inputs so the
    // one-pager can never show internally inconsistent math — but let an
    // explicit fairly-priced verdict from the reviewer stand.
    const merged = recomputeAnalysis({ ...(record.analysis || {}), ...overrides });
    if (typeof overrides.fairly_priced === "boolean") merged.fairly_priced = overrides.fairly_priced;
    record.analysis_override = merged;
  }
  if (typeof data.notes === "string") record.notes = data.notes.slice(0, 5000);
  record.updated_at = new Date().toISOString();
  await saveSubmission(store, record);
  return json({ ok: true, submission: record });
}

async function handleStatus(store, data, status) {
  const record = await loadSubmission(store, data.id);
  if (!record) return json({ ok: false, reason: "not found" }, 404);
  record.status = status;
  record[`${status}_at`] = new Date().toISOString();
  await saveSubmission(store, record);
  return json({ ok: true, submission: record });
}

async function handleRerun(store, data, url) {
  const record = await loadSubmission(store, data.id);
  if (!record) return json({ ok: false, reason: "not found" }, 404);
  if (!record.files.length) return json({ ok: false, reason: "no files to analyze" }, 400);
  record.status = "queued";
  record.analysis_error = null;
  await saveSubmission(store, record);
  await fetch(`${url.origin}/.netlify/functions/merchant-analyzer-background`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: record.id, token: submissionToken(record.id) }),
  });
  return json({ ok: true, queued: true });
}
