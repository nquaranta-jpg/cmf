// In-memory sliding-window rate limiter keyed by client IP. Good enough for v1:
// Netlify keeps a warm function instance around between requests, so a burst
// from one address is throttled within that instance. Not shared across
// instances or regions, and it resets on cold start. Upgrade to a store later
// if abuse ever shows up in the logs.

export type LimitName = "quote" | "book" | "other";

const WINDOW_MS = 10 * 60 * 1000;
const LIMITS: Record<LimitName, number> = { quote: 30, book: 5, other: 60 };
const MAX_KEYS = 5000;

const buckets = new Map<string, number[]>();

export function checkRateLimit(ip: string, name: LimitName, now = Date.now()): { allowed: boolean; retryAfterSec: number } {
  const key = `${name}:${ip || "unknown"}`;
  const cutoff = now - WINDOW_MS;
  const hits = (buckets.get(key) ?? []).filter((t) => t > cutoff);
  const limit = LIMITS[name];
  if (hits.length >= limit) {
    buckets.set(key, hits);
    const retryAfterSec = Math.max(1, Math.ceil((hits[0] + WINDOW_MS - now) / 1000));
    return { allowed: false, retryAfterSec };
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > MAX_KEYS) sweep(now);
  return { allowed: true, retryAfterSec: 0 };
}

function sweep(now: number) {
  const cutoff = now - WINDOW_MS;
  for (const [k, v] of buckets) {
    const live = v.filter((t) => t > cutoff);
    if (live.length === 0) buckets.delete(k);
    else buckets.set(k, live);
  }
}

/** Test hook. */
export function resetRateLimits() {
  buckets.clear();
}
