// POST /api/visit: page-view and time-on-page beacons from js/visit.js.
//
// Only browsers that arrived through a tagged email link send these (see
// lib/visits.mjs). The answer is always 204, so a guessed or stale token
// learns nothing. A recorded page view also re-sets the cmf_v cookie from the
// server: Safari keeps cookies written by JavaScript for only 7 days, but
// honors the full year for cookies set in a first-party response.
//
// Leads from the CMF agent app (links minted with a lead_id, i.e. primer
// emails): every recorded event is posted to the app's /api/site-visits with
// the running totals. The app moves the lead up the dial queue and gives the
// agent working it a task to call now; for the owner's own leads it answers
// alerted: "owner" and the owner gets the Telegram alert from here instead.
// Needs CMF_SITE_KEY (the same value in both Netlify sites); CMF_APP_URL
// defaults to https://app.crownmerchantfinancial.com.
//
// Everyone else, and an app lead whose webhook failed, gets the Telegram
// alert when they start a new visit (at most every 6 hours per person):
// VISIT_TELEGRAM_CHAT_ID if set, else TELEGRAM_CHAT_ID.

import { getStore } from "@netlify/blobs";
import { recordEvent, alertText, appVisitPayload, sessionsInLastWeek, deviceOf, isBotUa } from "./lib/visits.mjs";

export const config = { path: "/api/visit" };

const NO_CONTENT = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const ua = req.headers.get("user-agent") || "";
  if (isBotUa(ua)) return NO_CONTENT();

  let input;
  try {
    const text = await req.text();
    if (text.length > 2000) return NO_CONTENT();
    input = JSON.parse(text);
  } catch {
    return NO_CONTENT();
  }
  if (!input || typeof input !== "object") return NO_CONTENT();

  try {
    const store = getStore({ name: "visits", consistency: "strong" });
    const now = Date.now();
    const result = await recordEvent(store, { ...input, device: deviceOf(ua) }, now);
    // null = the app didn't take it (no key, down, slow, refused); ok:false = it isn't one of the app's leads
    // (anymore). Either way the Telegram alert goes out as for anyone else.
    const app = result.ok && result.record.lead_id ? await tellApp(appVisitPayload(result, input.t)) : null;
    if (app?.alerted === "owner") {
      // The owner's own lead: the app throttles these (4 hours per lead), so alert even inside our 6-hour window.
      const alert = result.alert || { token: input.t, record: result.record, path: result.path, device: result.device,
        ref: result.ref, summary: result.summary, sessionsThisWeek: sessionsInLastWeek(result.summary, now) };
      await sendAlert(alertText(alert, now));
    } else if (result.alert && (!app || app.ok === false)) {
      await sendAlert(alertText(result.alert, now));
    }
    if (result.ok && input.type === "view") {
      const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
      return new Response(null, {
        status: 204,
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": `cmf_v=${input.t}; Max-Age=31536000; Path=/; SameSite=Lax${secure}`,
        },
      });
    }
  } catch (err) {
    console.error("visit beacon failed:", err);
  }
  return NO_CONTENT();
};

/** Posts the visit to the agent app. Its answer ({ ok, alerted }) when it took it, else null. */
async function tellApp(payload) {
  const key = process.env.CMF_SITE_KEY;
  if (!key) return null;
  const base = (process.env.CMF_APP_URL || "https://app.crownmerchantfinancial.com").replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/api/site-visits`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Site-Key": key },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      console.error("visit: agent app answered", res.status);
      return null;
    }
    return (await res.json().catch(() => ({}))) || {};
  } catch (err) {
    console.error("visit: agent app unreachable:", err?.name || err);
    return null;
  }
}

async function sendAlert(text) {
  const bot = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.VISIT_TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
  if (!bot || !chat) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${bot}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.error("visit alert: Telegram answered", res.status);
  } catch (err) {
    console.error("visit alert failed:", err);
  }
}
