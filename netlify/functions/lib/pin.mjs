// Shared DASHBOARD_PIN check for the internal dashboards and exports.
//
// - Constant-time compare (both sides hashed first, so length doesn't leak).
// - Per-IP lockout: after MAX_FAILS wrong PINs in WINDOW_MS, that IP gets 429
//   until the window passes. Stored in Netlify Blobs; if Blobs is down the
//   lockout fails open but the PIN itself is still required.
// - Uses Netlify's own client IP header, which callers can't spoof (the
//   first X-Forwarded-For entry can be).
import { createHash, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";

const MAX_FAILS = 10;
const WINDOW_MS = 15 * 60 * 1000;

export function sameSecret(sent, expected) {
  if (typeof sent !== "string" || typeof expected !== "string" || !sent || !expected) return false;
  const a = createHash("sha256").update(sent).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Works with both a Headers object (v2 functions) and a plain object (v1). */
export function clientIpFrom(headers) {
  const get = (k) => (typeof headers?.get === "function" ? headers.get(k) : headers?.[k]);
  return String(get("x-nf-client-connection-ip") || get("client-ip") || "unknown");
}

function store() {
  return getStore({ name: "pin-lockout", consistency: "strong" });
}

function keyFor(ip) {
  return `ip/${ip.replace(/[^0-9a-fA-F.:]/g, "_")}`;
}

/**
 * Check a sent PIN against DASHBOARD_PIN.
 * Returns { ok: true } or { ok: false, status, error }.
 */
export async function checkPin(sent, headers) {
  const expected = process.env.DASHBOARD_PIN;
  if (!expected) return { ok: false, status: 503, error: "Not configured: set DASHBOARD_PIN in Netlify." };

  const key = keyFor(clientIpFrom(headers));
  let rec = null;
  try {
    rec = await store().get(key, { type: "json" });
    if (rec && Date.now() - rec.t > WINDOW_MS) rec = null;
  } catch (err) {
    console.error("pin lockout read failed (failing open):", err?.message);
  }
  if (rec && rec.n >= MAX_FAILS) {
    return { ok: false, status: 429, error: "Too many attempts. Try again in 15 minutes." };
  }

  if (sameSecret(sent, expected)) {
    if (rec) await store().delete(key).catch(() => {});
    return { ok: true };
  }

  try {
    await store().setJSON(key, { n: (rec?.n || 0) + 1, t: rec?.t || Date.now() });
  } catch (err) {
    console.error("pin lockout write failed:", err?.message);
  }
  return { ok: false, status: 401, error: "Invalid PIN" };
}
