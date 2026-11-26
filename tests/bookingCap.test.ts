import { describe, expect, it } from "vitest";
import { takeBookingSlot, BOOK_PER_IP_PER_DAY, BOOK_GLOBAL_PER_DAY, type CapStore } from "../src/mcp/lib/bookingCap.js";

function memStore(): CapStore {
  const m = new Map<string, { n: number }>();
  return { get: async (k) => m.get(k) ?? null, set: async (k, v) => void m.set(k, v) };
}

describe("booking daily caps", () => {
  const day = new Date("2026-11-26T18:00:00Z");
  it("caps one IP per Central-time day", async () => {
    const s = memStore();
    for (let i = 0; i < BOOK_PER_IP_PER_DAY; i++) expect(await takeBookingSlot("203.0.113.5", day, s)).toBe(true);
    expect(await takeBookingSlot("203.0.113.5", day, s)).toBe(false);
    expect(await takeBookingSlot("203.0.113.6", day, s)).toBe(true);
    expect(await takeBookingSlot("203.0.113.5", new Date("2026-11-27T18:00:00Z"), s)).toBe(true);
  });
  it("caps everyone together, so rotating IPs doesn't help", async () => {
    const s = memStore();
    for (let i = 0; i < BOOK_GLOBAL_PER_DAY; i++) expect(await takeBookingSlot(`198.51.100.${i}`, day, s)).toBe(true);
    expect(await takeBookingSlot("192.0.2.200", day, s)).toBe(false);
  });
  it("fails open if the store errors", async () => {
    const broken: CapStore = { get: async () => { throw new Error("down"); }, set: async () => undefined };
    expect(await takeBookingSlot("203.0.113.5", day, broken)).toBe(true);
  });
});
