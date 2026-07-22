// Shared spam-protection helpers for CMF Launch forms. Mirrors the
// protections in lead.mjs (honeypot, time-trap, format checks,
// disposable-email blocklist, per-IP rate limit, optional Turnstile)
// without touching the consumer funnel's code path.
import { getStore } from "@netlify/blobs";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const URL_IN_NAME_RE = /https?:\/\/|www\.|\.(com|net|org|biz|info|ru|cn|io|xyz)\b/i;
export const MIN_FORM_ELAPSED_MS = 1500;

// Trimmed blocklist: the highest-abuse disposable domains plus RFC 2606
// test domains. B2B agent forms see far less bot volume than the
// consumer funnel, so the top offenders cover it.
export const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "mailinator.net", "10minutemail.com", "guerrillamail.com",
  "sharklasers.com", "tempmail.com", "tempmail.org", "temp-mail.org",
  "yopmail.com", "throwawaymail.com", "dispostable.com", "fakeinbox.com",
  "mailnesia.com", "getnada.com", "maildrop.cc", "mintemail.com",
  "trashmail.com", "spamgourmet.com", "jetable.org", "emailondeck.com",
  "mohmal.com", "moakt.com", "mail.tm", "tmpmail.org", "33mail.com",
  "emailfake.com", "burnermail.io",
  "example.com", "example.org", "example.net", "test.com", "test.org",
]);

export function emailDomain(email) {
  if (!email || typeof email !== "string") return "";
  const at = email.lastIndexOf("@");
  return at < 0 ? "" : email.slice(at + 1).trim().toLowerCase();
}

// Per-IP rate limiter using Netlify Blobs. Fails open so a blob outage
// doesn't break submissions.
export async function checkRateLimit(ip, { max = 5, windowMs = 60 * 60 * 1000, storeName = "launch-rate-limits" } = {}) {
  if (!ip || ip === "unknown") return { allowed: true, count: 0 };
  try {
    const store = getStore({ name: storeName, consistency: "strong" });
    const key = `ip:${ip.replace(/[^a-zA-Z0-9.:]/g, "_")}`;
    const entry = await store.get(key, { type: "json" });
    const now = Date.now();
    if (!entry || (now - entry.windowStart) > windowMs) {
      await store.setJSON(key, { count: 1, windowStart: now });
      return { allowed: true, count: 1 };
    }
    if (entry.count >= max) return { allowed: false, count: entry.count };
    await store.setJSON(key, { count: entry.count + 1, windowStart: entry.windowStart });
    return { allowed: true, count: entry.count + 1 };
  } catch (err) {
    console.error("Launch rate limit error (failing open):", err);
    return { allowed: true, count: 0 };
  }
}

// Cloudflare Turnstile verification. Active only when
// TURNSTILE_SECRET_KEY is set (same key the consumer forms use).
// Fails closed when active.
export async function verifyTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true, skipped: true };
  if (!token) return { ok: false, reason: "missing token" };
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: token, remoteip: ip }),
    });
    const json = await res.json();
    return json.success ? { ok: true } : { ok: false, reason: (json["error-codes"] || []).join(",") };
  } catch (err) {
    console.error("Turnstile verify error:", err);
    return { ok: false, reason: "verify unreachable" };
  }
}

export function clientIp(event) {
  return (event.headers["x-forwarded-for"] || "").split(",")[0].trim()
    || event.headers["client-ip"]
    || "unknown";
}
