// Background worker for the Merchants statement analyzer.
//
// Netlify background function (name ends in -background → 202 immediately,
// up to 15 minutes of execution). Runs the Claude extraction over the
// uploaded statement pages and stores the result on the submission record.
// Nothing is ever sent to the prospect from here — analysis lands in
// "analyzed" (or "needs_manual") status and waits for human review.
//
// Auth: requires the internal HMAC submission token, so only our own
// finalize/rerun endpoints can trigger work.
import {
  getMerchantStore, loadSubmission, saveSubmission,
  verifySubmissionToken, runExtraction, notifyTelegram,
} from "./lib/merchants.mjs";

export default async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  let data;
  try {
    data = await req.json();
  } catch {
    return new Response("invalid json", { status: 400 });
  }
  const { id, token } = data;
  if (!verifySubmissionToken(id, token)) return new Response("unauthorized", { status: 401 });

  const store = getMerchantStore();
  const record = await loadSubmission(store, id);
  if (!record) return new Response("not found", { status: 404 });

  record.status = "analyzing";
  record.analysis_error = null;
  await saveSubmission(store, record);

  try {
    const analysis = await runExtraction(store, record);
    record.analysis = analysis;
    record.analyzed_at = new Date().toISOString();
    // Low confidence or missing core numbers → flag for manual analysis
    // instead of trusting the extraction. The lead is kept either way.
    const coreMissing = analysis.total_card_volume == null || analysis.total_fees_charged == null;
    record.status = analysis.confidence === "low" || coreMissing ? "needs_manual" : "analyzed";
    await saveSubmission(store, record);

    const savings = typeof analysis.estimated_annual_savings === "number"
      ? `$${analysis.estimated_annual_savings.toLocaleString("en-US")}`
      : "n/a";
    await notifyTelegram(
      `🔍 *Merchants — Analysis ready for review*\n` +
      `🏢 ${record.contact.business}\n` +
      `📈 Effective rate: ${analysis.effective_rate ?? "?"}%\n` +
      `💰 Est. annual savings: ${savings}\n` +
      `${analysis.fairly_priced ? "🤝 Looks fairly priced" : "🚩 " + (analysis.red_flags?.length || 0) + " red flags"}\n` +
      `Status: ${record.status} (confidence: ${analysis.confidence})\n` +
      `Review: https://crownmerchantfinancial.com/merchants/review`
    );
  } catch (err) {
    console.error("merchant analysis failed:", err);
    record.status = "needs_manual";
    record.analysis_error = String(err?.message || err).slice(0, 500);
    await saveSubmission(store, record);
    await notifyTelegram(
      `⚠️ *Merchants — Automated analysis failed*\n` +
      `🏢 ${record.contact.business}\n` +
      `Reason: ${record.analysis_error}\n` +
      `Lead is captured — analyze manually from the review page.`
    );
  }

  return new Response("ok", { status: 200 });
};
