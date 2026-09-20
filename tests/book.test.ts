import { describe, expect, it } from "vitest";
import { bookConsultation, validateBookInput } from "../src/mcp/tools/book.js";
import { MSG_BOOKING_UNAVAILABLE, MSG_CONSENT_REQUIRED, CONSENT_VERSION } from "../src/mcp/config/copy.js";
import { fakeFetch, validBooking } from "./helpers.js";

const SECRET = "test-secret-0123456789-abcdefghijklmnop";
const env = { BOOKER_URL: "https://script.google.com/macros/s/fake/exec", BOOKER_SECRET: SECRET } as NodeJS.ProcessEnv;

describe("book_consultation: validation", () => {
  it("rejects when consent is false or missing", async () => {
    const a = await bookConsultation({ ...validBooking(), consent_to_contact: false }, { env });
    expect(a).toEqual({ error: MSG_CONSENT_REQUIRED });
    const { consent_to_contact: _c, ...rest } = validBooking();
    const b = await bookConsultation(rest, { env });
    expect(b).toEqual({ error: MSG_CONSENT_REQUIRED });
  });
  it("rejects bad email and bad phone with plain messages", async () => {
    expect((await bookConsultation({ ...validBooking(), email: "nope" }, { env })) as object).toMatchObject({ error: expect.stringMatching(/email/) });
    expect((await bookConsultation({ ...validBooking(), phone: "555-0142" }, { env })) as object).toMatchObject({ error: expect.stringMatching(/phone/) });
    expect((await bookConsultation({ ...validBooking(), phone: "(012) 555-0142" }, { env })) as object).toMatchObject({ error: expect.stringMatching(/phone/) });
  });
  it("normalizes phone to E.164 and email to lowercase, strips control chars from names", () => {
    const v = validateBookInput({ ...validBooking(), phone: "1 (312) 555-0142", email: "Test@Example.COM", first_name: "Te" + String.fromCharCode(0) + "st" + String.fromCharCode(0x200b) });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.data.phone).toBe("+13125550142");
      expect(v.data.email).toBe("test@example.com");
      expect(v.data.first_name).toBe("Test");
    }
  });
  it("caps names at 60 characters", () => {
    const v = validateBookInput({ ...validBooking(), last_name: "x".repeat(200) });
    expect(v.ok && v.data.last_name.length).toBe(60);
  });
  it("requires an ISO 8601 time with offset", async () => {
    expect((await bookConsultation({ ...validBooking(), preferred_start: "Tuesday at 2pm" }, { env })) as object).toMatchObject({ error: expect.stringMatching(/preferred_start/) });
    expect((await bookConsultation({ ...validBooking(), preferred_start: "2026-09-22T14:00:00" }, { env })) as object).toMatchObject({ error: expect.stringMatching(/preferred_start/) });
    expect(validateBookInput({ ...validBooking(), preferred_start: "2026-09-22T19:00:00Z" }).ok).toBe(true);
  });
  it("rejects an unlicensed state without calling the booker", async () => {
    const { fn, calls } = fakeFetch({ status: "booked" });
    const out = (await bookConsultation({ ...validBooking(), state: "CA" }, { env, fetchImpl: fn })) as { result: { status: string; message: string } };
    expect(out.result.status).toBe("not_available");
    expect(out.result.message).toMatch(/not currently licensed in CA/);
    expect(calls.length).toBe(0);
  });
});

describe("book_consultation: booker integration", () => {
  it("posts the secret plus the lead and passes a booked result through", async () => {
    const { fn, calls } = fakeFetch({ status: "booked", start: "2026-09-22T14:00:00-05:00", end: "2026-09-22T14:20:00-05:00", meet_link: "https://meet.google.com/abc-defg-hij", confirmation_sent_to: "test@example.com" });
    const now = () => new Date("2026-09-20T12:00:00Z");
    const out = (await bookConsultation(validBooking(), { env, fetchImpl: fn, now })) as { result: Record<string, unknown> };
    expect(out.result).toEqual({
      status: "booked",
      start: "2026-09-22T14:00:00-05:00",
      end: "2026-09-22T14:20:00-05:00",
      meet_link: "https://meet.google.com/abc-defg-hij",
      confirmation_sent_to: "test@example.com",
    });
    expect(calls[0].url).toBe(env.BOOKER_URL);
    const sent = calls[0].body as Record<string, unknown>;
    expect(sent.secret).toBe(SECRET);
    expect(sent.phone).toBe("+13125550142");
    expect(sent.source).toBe("muse");
    expect(sent.consent_version).toBe(CONSENT_VERSION);
    expect(sent.consent_timestamp).toBe("2026-09-20T12:00:00.000Z");
    expect(sent.quote_context).toMatchObject({ monthly_low: 30, monthly_high: 45 });
  });
  it("passes slot_unavailable through with at most 3 alternatives", async () => {
    const alts = ["2026-09-22T14:20:00-05:00", "2026-09-22T14:40:00-05:00", "2026-09-22T15:00:00-05:00", "2026-09-22T15:20:00-05:00"];
    const { fn } = fakeFetch({ status: "slot_unavailable", message: "That time is taken.", alternatives: alts });
    const out = (await bookConsultation(validBooking(), { env, fetchImpl: fn })) as { result: { status: string; alternatives: string[] } };
    expect(out.result.status).toBe("slot_unavailable");
    expect(out.result.alternatives).toEqual(alts.slice(0, 3));
  });
  it("passes already_booked and invalid_time through", async () => {
    const a = (await bookConsultation(validBooking(), { env, fetchImpl: fakeFetch({ status: "already_booked", start: "2026-09-23T10:00:00-05:00" }).fn })) as { result: Record<string, unknown> };
    expect(a.result.status).toBe("already_booked");
    expect(a.result.start).toBe("2026-09-23T10:00:00-05:00");
    const b = (await bookConsultation(validBooking(), { env, fetchImpl: fakeFetch({ status: "invalid_time", message: "Outside business hours." }).fn })) as { result: Record<string, unknown> };
    expect(b.result).toEqual({ status: "invalid_time", message: "Outside business hours." });
  });
  it("fails closed when the booker throws, returns non-2xx, returns garbage, or is not JSON", async () => {
    const expectUnavailable = async (fn: typeof fetch) => {
      const out = (await bookConsultation(validBooking(), { env, fetchImpl: fn })) as { result: { status: string; message: string } };
      expect(out.result).toEqual({ status: "unavailable", message: MSG_BOOKING_UNAVAILABLE });
    };
    await expectUnavailable(fakeFetch({}, { throws: true }).fn);
    await expectUnavailable(fakeFetch({ status: "booked" }, { status: 500 }).fn);
    await expectUnavailable(fakeFetch({ status: "error", message: "Exception: boom" }).fn);
    await expectUnavailable(fakeFetch({ nonsense: true }).fn);
    await expectUnavailable((async () => new Response("<html>not json</html>", { status: 200 })) as unknown as typeof fetch);
  });
  it("fails closed when BOOKER_URL or BOOKER_SECRET is missing", async () => {
    const { fn, calls } = fakeFetch({ status: "booked" });
    const out = (await bookConsultation(validBooking(), { env: {} as NodeJS.ProcessEnv, fetchImpl: fn })) as { result: { status: string } };
    expect(out.result.status).toBe("unavailable");
    expect(calls.length).toBe(0);
  });
  it("never leaks the secret in any response, even if the booker echoes it", async () => {
    const leaky = { status: "booked", start: "x", end: "y", meet_link: "z", confirmation_sent_to: "e", secret: SECRET, message: SECRET };
    const responses = await Promise.all([
      bookConsultation(validBooking(), { env, fetchImpl: fakeFetch(leaky).fn }),
      bookConsultation(validBooking(), { env, fetchImpl: fakeFetch({ status: "error", message: SECRET }).fn }),
      bookConsultation(validBooking(), { env, fetchImpl: fakeFetch({ status: "invalid_time" }).fn }),
      bookConsultation({ ...validBooking(), consent_to_contact: false }, { env }),
      bookConsultation(validBooking(), { env: { BOOKER_SECRET: SECRET } as NodeJS.ProcessEnv }),
    ]);
    for (const r of responses) expect(JSON.stringify(r)).not.toContain(SECRET);
  });
});
