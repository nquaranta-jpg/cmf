// Durable daily caps on book_consultation, shared across every function
// instance (the in-memory limiter in rateLimit.ts resets on cold start and
// isn't shared). Each booking emails a confirmation from our Gmail and adds a
// calendar event, so this bounds how much one person, or a botnet rotating
// IPs, can spam strangers or fill the calendar in a day.
//
// Counters live in Netlify Blobs, keyed by Central-time day. Writes are
// best effort (no compare-and-swap in @netlify/blobs 8), so a burst of
// parallel calls can slightly overshoot; the in-memory limiter still caps
// each instance. If Blobs is unreachable this fails open and the in-memory
// limit is the only guard.

import { getStore } from "@netlify/blobs";

export const BOOK_PER_IP_PER_DAY = 5;
export const BOOK_GLOBAL_PER_DAY = 40;

type Counter = { n: number };

function dayKey(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(now); // YYYY-MM-DD
}

export type CapStore = {
  get(key: string): Promise<Counter | null>;
  set(key: string, value: Counter): Promise<void>;
};

function blobStore(): CapStore {
  const store = getStore({ name: "mcp-booking-caps", consistency: "strong" });
  return {
    get: async (key) => ((await store.get(key, { type: "json" })) as Counter | null) ?? null,
    set: async (key, value) => {
      await store.setJSON(key, value);
    },
  };
}

/** Counts one booking attempt. Returns false when a daily cap is already used up. */
export async function takeBookingSlot(ip: string, now = new Date(), store: CapStore | null = null): Promise<boolean> {
  try {
    const s = store ?? blobStore();
    const day = dayKey(now);
    const ipKey = `${day}/ip/${(ip || "unknown").replace(/[^0-9a-fA-F.:]/g, "_")}`;
    const allKey = `${day}/all`;
    const [ipRec, allRec] = await Promise.all([s.get(ipKey), s.get(allKey)]);
    const ipN = ipRec?.n ?? 0;
    const allN = allRec?.n ?? 0;
    if (ipN >= BOOK_PER_IP_PER_DAY || allN >= BOOK_GLOBAL_PER_DAY) return false;
    await Promise.all([s.set(ipKey, { n: ipN + 1 }), s.set(allKey, { n: allN + 1 })]);
    return true;
  } catch (err) {
    console.error(JSON.stringify({ src: "mcp", status: "booking_cap_error", message: err instanceof Error ? err.message : "unknown" }));
    return true;
  }
}
