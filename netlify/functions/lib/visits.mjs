// Tagged-link visitor tracking: the logic shared by /api/visit (beacons from
// js/visit.js) and /api/visit-admin (minting links, the dashboard feed).
//
// How it works: every link we email to a known person carries ?v=<token>. The
// token is random (it encodes nothing) and maps to that person in the
// "visits" Netlify Blobs store. js/visit.js keeps the token in a first-party
// cookie, so later visits from the same browser are recognized too. Visitors
// who never clicked a tagged link are not tracked at all.
//
// Store layout (all JSON):
//   tok/<token>          { email, name, source, lead_id, created }
//   email/<sha256>       { token }                 one token per email address
//   sum/<token>          running totals, see emptySummary()
//   ev/<token>/<ms>-<r>  one event: { type, path, secs, ref, device, ts }
//
// Everything here takes the store as an argument (Netlify Blobs in
// production, an in-memory Map in tests) and never reads the clock itself.

import { createHash, randomBytes } from "node:crypto";

export const TOKEN_RE = /^[A-Za-z0-9_-]{16}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const SITE_ORIGIN = "https://crownmerchantfinancial.com";
const SITE_HOSTS = new Set(["crownmerchantfinancial.com", "www.crownmerchantfinancial.com"]);

// Pages that load js/visit.js (in <head>, before any ad pixel). Links may only
// point here: on any other page the token would stay in the address bar where
// third-party scripts can read it. tests/visits.test.ts checks this list
// against the HTML files.
export const TRACKED_PAGES = [
  "/", "/agents", "/clients", "/investors", "/community",
  "/insights", "/insights/bermuda-triangles", "/insights/insurance-is-the-last-moat", "/card", "/card/conrad",
  "/card/denise", "/launch", "/launch/ads", "/launch/leads", "/launch/training",
  "/launch/match", "/onboarding", "/privacy", "/terms", "/sms",
  "/products/annuity", "/products/final-expense", "/products/iul", "/products/term-life", "/quote",
  "/society", "/society/workshops", "/society/new-fortunes", "/thank-you", "/vgli-calculator",
  "/pick-your-policy",
];
const TRACKED_SET = new Set(TRACKED_PAGES);

/** "/launch/", "/launch.html" and "/launch/index.html" all mean "/launch". */
export function pageKey(pathname) {
  let p = String(pathname || "/").replace(/\/index\.html$/, "/").replace(/\.html$/, "");
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p || "/";
}

export const SESSION_GAP_MS = 30 * 60 * 1000; // a new visit after 30 min of silence
export const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // at most one alert per person per 6 h
export const HOURLY_EVENT_CAP = 200; // per token, guards against a leaked link being hammered
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PAGES = 60;
const MAX_SESSION_TIMES = 30;
const MAX_SECS_PER_EVENT = 30 * 60;
// Totals keep counting past this, but no more per-event blobs are written for
// one person. Bounds storage even if the hourly cap is raced (see recordEvent).
export const MAX_EVENTS_PER_TOKEN = 5000;

export function newToken() {
  return randomBytes(12).toString("base64url"); // 16 chars, 96 random bits
}

export function normEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function emailKey(email) {
  return "email/" + createHash("sha256").update(normEmail(email)).digest("hex");
}

function clip(s, n) {
  return String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n);
}

/** Only a clean site path is stored: no query string, no fragment, no odd characters. */
export function cleanPath(p) {
  const s = String(p || "");
  if (!s.startsWith("/") || s.startsWith("//")) return null;
  const path = s.split(/[?#]/)[0].slice(0, 200);
  if (!/^\/[A-Za-z0-9._~\/-]*$/.test(path)) return null;
  return path;
}

/** Referrers are kept as a bare host ("google.com"), never a full URL. */
export function cleanRef(r) {
  const s = String(r || "").trim().toLowerCase();
  if (!s) return "";
  const host = s.replace(/^https?:\/\//, "").split(/[\/?#:]/)[0];
  if (!/^[a-z0-9.-]{1,120}$/.test(host) || SITE_HOSTS.has(host)) return "";
  return host.replace(/^www\./, "");
}

export function deviceOf(ua) {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(String(ua || "")) ? "phone" : "computer";
}

const BOT_UA_RE = /bot|crawl|spider|slurp|preview|scanner|headless|phantom|lighthouse|pingdom|monitor|curl|wget|python|java\/|go-http|okhttp|axios|node-fetch/i;
export function isBotUa(ua) {
  return !ua || BOT_UA_RE.test(String(ua));
}

/**
 * Adds ?v=<token> to a link on our site. Accepts a full URL on
 * crownmerchantfinancial.com or a site path ("/launch"), and only for pages in
 * TRACKED_PAGES. Anything else is rejected, so a token never sits in the
 * address bar of a page (or site) that doesn't strip it.
 */
export function tagUrl(url, token) {
  const raw = String(url || "/").trim() || "/";
  let u;
  try {
    u = raw.startsWith("/") && !raw.startsWith("//") ? new URL(raw, SITE_ORIGIN) : new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !SITE_HOSTS.has(u.hostname)) return null;
  if (!TRACKED_SET.has(pageKey(u.pathname))) return null;
  u.searchParams.set("v", token);
  return u.toString();
}

/**
 * One token per email address: minting the same address again returns the
 * existing token, so a person's history stays in one place across campaigns.
 * A later mint fills in a missing name (never overwrites one) and takes over
 * lead_id: FMCSA leads often share an email, and the lead that got the latest
 * primer is the one being worked, so its agent should hear about the visits.
 * `source` is the first campaign that reached them.
 */
export async function mint(store, { email, name, source, lead_id }, now) {
  const e = normEmail(email);
  if (!EMAIL_RE.test(e) || e.length > 200) return { error: "invalid email" };
  const ek = emailKey(e);
  const existing = await store.get(ek, { type: "json" });
  if (existing?.token) {
    const rec = await store.get("tok/" + existing.token, { type: "json" });
    if (rec) {
      let changed = false;
      if (!rec.name && name) { rec.name = clip(name, 120); changed = true; }
      if (lead_id && rec.lead_id !== clip(lead_id, 60)) { rec.lead_id = clip(lead_id, 60); changed = true; }
      if (changed) await store.setJSON("tok/" + existing.token, rec);
      return { token: existing.token, created: false, record: rec };
    }
  }
  const token = newToken();
  const record = {
    email: e,
    name: clip(name, 120),
    source: clip(source, 60),
    lead_id: clip(lead_id, 60),
    created: now,
  };
  // Write the token record before the email index so a reader that finds the
  // index entry always finds the record it points to.
  await store.setJSON("tok/" + token, record);
  await store.setJSON(ek, { token });
  // Two requests minting the same new address at once both get here. The
  // index keeps the last write, so re-read it: the loser drops its record and
  // returns the winner's token, leaving one token per address.
  const winner = await store.get(ek, { type: "json" });
  if (winner?.token && winner.token !== token) {
    const rec = await store.get("tok/" + winner.token, { type: "json" });
    if (rec) {
      await store.delete("tok/" + token);
      return { token: winner.token, created: false, record: rec };
    }
  }
  return { token, created: true, record };
}

/**
 * Mints a batch (deduplicated by email, so two rows for one address can't
 * race into two tokens) and returns one result per input row, in order.
 */
export async function mintMany(store, rows, { source, url } = {}, now) {
  const unique = new Map();
  for (const row of rows) {
    const e = normEmail(row?.email);
    if (e && !unique.has(e)) unique.set(e, row);
  }
  const minted = new Map();
  await mapLimit([...unique.entries()], 8, async ([e, row]) => {
    minted.set(e, await mint(store, { ...row, source: row.source || source }, now));
  });
  const seen = new Set();
  return rows.map((row) => {
    const e = normEmail(row?.email);
    const m = minted.get(e) || { error: "invalid email" };
    if (m.error) return { email: row?.email || "", error: m.error };
    const first = !seen.has(e);
    seen.add(e);
    return {
      email: e,
      name: m.record.name,
      lead_id: m.record.lead_id,
      token: m.token,
      created: m.created && first,
      link: tagUrl(row.url || url || "/", m.token),
    };
  });
}

export function emptySummary() {
  return {
    first: null, // first event (ms)
    last: null, // latest event (ms)
    sessions: 0, // visits, split by SESSION_GAP_MS
    sessionTimes: [], // start of the latest visits (ms), newest last
    views: 0, // page views
    secs: 0, // active seconds on site
    pages: {}, // path -> views
    lastPath: "",
    device: "",
    alertAt: 0,
    hour: 0, // hour bucket for the rate cap
    hourCount: 0,
    events: 0, // per-event blobs written (see MAX_EVENTS_PER_TOKEN)
  };
}

export function sessionsInLastWeek(sum, now) {
  return (sum.sessionTimes || []).filter((t) => now - t < WEEK_MS).length;
}

/** "Hot" = came back within the week, or spent real time reading. */
export function isHot(sum, now) {
  return sessionsInLastWeek(sum, now) >= 2 || sum.secs >= 120;
}

/**
 * Records one beacon. sum/<token> is read-modify-write without a conditional
 * write (@netlify/blobs 8 has none), so simultaneous beacons for one token can
 * each pass the hourly cap or the alert cooldown before either saves. Real
 * visitors send a beacon every few seconds at most; the risk is a leaked link
 * being hammered, and MAX_EVENTS_PER_TOKEN bounds what that can store.
 *
 * Returns { ok:false } for unknown tokens and bad input (the endpoint answers
 * 204 either way), and otherwise { ok:true, alert, newVisit, record, summary }.
 * newVisit is true when this view starts a visit (30 quiet minutes before
 * it); alert is non-null when it also falls outside the ALERT_COOLDOWN_MS.
 */
export async function recordEvent(store, input, now) {
  const token = String(input?.t || "");
  if (!TOKEN_RE.test(token)) return { ok: false, reason: "token" };
  const type = input.type === "time" ? "time" : input.type === "view" ? "view" : null;
  if (!type) return { ok: false, reason: "type" };
  const path = cleanPath(input.p);
  if (!path) return { ok: false, reason: "path" };

  const rec = await store.get("tok/" + token, { type: "json" });
  if (!rec) return { ok: false, reason: "unknown" };

  const sum = { ...emptySummary(), ...((await store.get("sum/" + token, { type: "json" })) || {}) };

  const hour = Math.floor(now / 3600000);
  if (sum.hour !== hour) { sum.hour = hour; sum.hourCount = 0; }
  if (sum.hourCount >= HOURLY_EVENT_CAP) return { ok: false, reason: "rate" };
  sum.hourCount += 1;

  const device = input.device || "";
  const ref = cleanRef(input.r);
  let secs = 0;
  let alert = null;
  let newSession = false;

  if (type === "view") {
    newSession = !sum.last || now - sum.last > SESSION_GAP_MS;
    if (newSession) {
      sum.sessions += 1;
      sum.sessionTimes = [...(sum.sessionTimes || []), now].slice(-MAX_SESSION_TIMES);
    }
    sum.views += 1;
    if (sum.pages[path] || Object.keys(sum.pages).length < MAX_PAGES) {
      sum.pages[path] = (sum.pages[path] || 0) + 1;
    }
    sum.lastPath = path;
    if (device) sum.device = device;
    if (newSession && now - (sum.alertAt || 0) > ALERT_COOLDOWN_MS) {
      sum.alertAt = now;
      alert = { token, record: rec, path, device, ref, sessionsThisWeek: sessionsInLastWeek(sum, now) };
    }
  } else {
    secs = Math.max(0, Math.min(MAX_SECS_PER_EVENT, Math.round(Number(input.s) || 0)));
    if (!secs) return { ok: false, reason: "secs" };
    sum.secs += secs;
  }
  sum.first = sum.first || now;
  sum.last = now;

  const logEvent = (sum.events || 0) < MAX_EVENTS_PER_TOKEN;
  if (logEvent) sum.events = (sum.events || 0) + 1;
  await store.setJSON("sum/" + token, sum);
  if (logEvent) {
    const evKey = `ev/${token}/${String(now).padStart(14, "0")}-${randomBytes(3).toString("hex")}`;
    await store.setJSON(evKey, { type, path, secs, ref, device, ts: now });
  }
  if (alert) alert.summary = sum;
  return { ok: true, alert, newVisit: newSession, record: rec, summary: sum, path, device, ref };
}

/**
 * What the CMF agent app gets about a visit by one of its leads (links minted
 * with a lead_id, i.e. primer emails). Totals are cumulative, so a lost
 * webhook is made up by the next one.
 */
export function appVisitPayload(result, token) {
  const { record, summary, newVisit, path, device, ref } = result;
  return {
    lead_id: record.lead_id,
    email: record.email,
    token,
    source: record.source,
    new_visit: !!newVisit,
    path,
    device,
    ref,
    sessions: summary.sessions,
    views: summary.views,
    secs: summary.secs,
    first_seen: summary.first,
    last_seen: summary.last,
    pages: Object.entries(summary.pages || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([p, n]) => ({ path: p, views: n })),
  };
}

/** Plain-text Telegram alert (no Markdown: names and paths would need escaping). */
export function alertText(alert, now) {
  const r = alert.record;
  const s = alert.summary;
  const who = r.name ? `${r.name} (${r.email})` : r.email;
  const lines = [
    `${isHot(s, now) ? "🔥" : "👀"} ${who} is on the website now`,
    `Page: ${alert.path}${alert.device ? ` on a ${alert.device}` : ""}`,
    `Visit ${s.sessions} · ${s.views} page views · ${formatSecs(s.secs)} on site so far`,
  ];
  if (alert.sessionsThisWeek >= 2) lines.push(`${alert.sessionsThisWeek} visits this week`);
  if (alert.ref) lines.push(`Came from: ${alert.ref}`);
  if (r.source) lines.push(`Link from: ${r.source}`);
  if (r.lead_id) lines.push(`Lead ID: ${r.lead_id}`);
  lines.push(`${SITE_ORIGIN}/dashboard/visitors.html#t=${alert.token}`);
  return lines.join("\n");
}

export function formatSecs(secs) {
  const n = Math.round(secs || 0);
  if (n < 60) return `${n}s`;
  const m = Math.floor(n / 60);
  if (m < 60) return `${m}m ${n % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

async function listKeys(store, prefix) {
  const { blobs } = await store.list({ prefix });
  return blobs.map((b) => b.key);
}

/** Runs fn over items, at most `limit` at a time (Blobs reads are HTTP calls). */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Everyone seen in the last `days` days, most recent first: the first `limit`
 * as rows, plus totals over all of them.
 */
export async function listActivity(store, { days = 30, limit = 300 } = {}, now) {
  const keys = await listKeys(store, "sum/");
  const sums = await mapLimit(keys, 8, async (k) => ({ token: k.slice(4), sum: await store.get(k, { type: "json" }) }));
  const inRange = sums
    .filter((x) => x.sum && x.sum.last && now - x.sum.last <= days * 86400000)
    .sort((a, b) => b.sum.last - a.sum.last);
  const totals = {
    people: inRange.length,
    views: inRange.reduce((n, x) => n + (x.sum.views || 0), 0),
    hot: inRange.filter((x) => isHot(x.sum, now)).length,
  };
  const recent = inRange.slice(0, limit);
  const rows = await mapLimit(recent, 8, async ({ token, sum }) => {
    const rec = (await store.get("tok/" + token, { type: "json" })) || {};
    const topPages = Object.entries(sum.pages || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([path, n]) => ({ path, n }));
    return {
      token,
      email: rec.email || "",
      name: rec.name || "",
      source: rec.source || "",
      lead_id: rec.lead_id || "",
      first: sum.first,
      last: sum.last,
      sessions: sum.sessions,
      sessionsThisWeek: sessionsInLastWeek(sum, now),
      views: sum.views,
      secs: sum.secs,
      device: sum.device,
      lastPath: sum.lastPath,
      topPages,
      hot: isHot(sum, now),
    };
  });
  return { rows, totals, truncated: inRange.length > rows.length };
}

/** One person's record, totals and latest events (newest first). */
export async function history(store, token, { limit = 200 } = {}) {
  if (!TOKEN_RE.test(String(token || ""))) return null;
  const record = await store.get("tok/" + token, { type: "json" });
  if (!record) return null;
  const summary = (await store.get("sum/" + token, { type: "json" })) || emptySummary();
  const keys = (await listKeys(store, `ev/${token}/`)).sort().reverse().slice(0, limit);
  const events = (await mapLimit(keys, 8, (k) => store.get(k, { type: "json" }))).filter(Boolean);
  return { token, record, summary, events };
}

export async function findToken(store, email) {
  const idx = await store.get(emailKey(email), { type: "json" });
  return idx?.token || null;
}

/** Deletes everything held about one person (for privacy deletion requests). */
export async function forget(store, { token, email }) {
  let t = token && TOKEN_RE.test(token) ? token : null;
  if (!t && email) t = await findToken(store, email);
  if (!t) return { deleted: 0 };
  const rec = await store.get("tok/" + t, { type: "json" });
  const keys = await listKeys(store, `ev/${t}/`);
  await mapLimit(keys, 8, (k) => store.delete(k));
  await store.delete("sum/" + t);
  await store.delete("tok/" + t);
  if (rec?.email) await store.delete(emailKey(rec.email));
  return { deleted: keys.length + 2 + (rec?.email ? 1 : 0), token: t, email: rec?.email || "", lead_id: rec?.lead_id || "" };
}
