import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  mint,
  mintMany,
  recordEvent,
  listActivity,
  history,
  forget,
  findToken,
  tagUrl,
  cleanPath,
  cleanRef,
  isBotUa,
  alertText,
  appVisitPayload,
  SESSION_GAP_MS,
  ALERT_COOLDOWN_MS,
  HOURLY_EVENT_CAP,
  TOKEN_RE,
  TRACKED_PAGES,
  MAX_EVENTS_PER_TOKEN,
  pageKey,
  type VisitStore,
} from "../netlify/functions/lib/visits.mjs";

/** In-memory stand-in for a Netlify Blobs store (JSON round-trip like the real one). */
function memStore(): VisitStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async get(key) {
      const v = data.get(key);
      return v === undefined ? null : JSON.parse(v);
    },
    async setJSON(key, value) {
      data.set(key, JSON.stringify(value));
    },
    async delete(key) {
      data.delete(key);
    },
    async list({ prefix }) {
      return { blobs: [...data.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) };
    },
  };
}

const T0 = Date.UTC(2026, 10, 21, 15, 0, 0);
const MIN = 60 * 1000;

async function mintToken(store: VisitStore, email = "jane@example.com", extra: Record<string, string> = {}) {
  const m = await mint(store, { email, ...extra }, T0);
  if (m.error !== undefined) throw new Error(m.error);
  return m.token;
}

describe("tagUrl", () => {
  it("tags site paths and site URLs, keeping other params", () => {
    expect(tagUrl("/launch", "a".repeat(16))).toBe("https://crownmerchantfinancial.com/launch?v=" + "a".repeat(16));
    expect(tagUrl("https://www.crownmerchantfinancial.com/quote?utm_source=x#top", "b".repeat(16))).toBe(
      "https://www.crownmerchantfinancial.com/quote?utm_source=x&v=" + "b".repeat(16) + "#top",
    );
  });
  it("refuses other sites, protocol-relative links and plain http", () => {
    expect(tagUrl("https://evil.com/launch", "a".repeat(16))).toBeNull();
    expect(tagUrl("//evil.com/x", "a".repeat(16))).toBeNull();
    expect(tagUrl("http://crownmerchantfinancial.com/", "a".repeat(16))).toBeNull();
    expect(tagUrl("https://crownmerchantfinancial.com.evil.com/", "a".repeat(16))).toBeNull();
    expect(tagUrl("javascript:alert(1)", "a".repeat(16))).toBeNull();
  });
  it("only tags pages that load js/visit.js", () => {
    expect(tagUrl("/launch/", "a".repeat(16))).not.toBeNull();
    expect(tagUrl("/launch/login", "a".repeat(16))).toBeNull();
    expect(tagUrl("/connect/muse", "a".repeat(16))).toBeNull();
    expect(tagUrl("/dashboard/visitors.html", "a".repeat(16))).toBeNull();
  });
});

describe("TRACKED_PAGES matches the site", () => {
  const ROOT = join(__dirname, "..");
  // Static paths served through a netlify.toml rewrite rather than a same-named file.
  const ALIASES: Record<string, string> = { "/pick-your-policy": "quote.html" };
  const fileFor = (page: string) => {
    if (ALIASES[page]) return ALIASES[page];
    if (page === "/") return "index.html";
    const rel = page.slice(1);
    return existsSync(join(ROOT, rel + ".html")) ? rel + ".html" : join(rel, "index.html");
  };

  it.each(TRACKED_PAGES)("%s loads visit.js first in <head>, without defer", (page) => {
    const html = readFileSync(join(ROOT, fileFor(page)), "utf8");
    const head = html.slice(0, html.toLowerCase().indexOf("</head>"));
    const firstScript = head.match(/<script(?![^>]*application\/ld\+json)[^>]*>/i);
    expect(firstScript?.[0]).toBe('<script src="/js/visit.js">'); // no defer, no async
  });

  it("normalizes page paths", () => {
    expect(pageKey("/launch/")).toBe("/launch");
    expect(pageKey("/launch/index.html")).toBe("/launch");
    expect(pageKey("/quote.html")).toBe("/quote");
    expect(pageKey("/index.html")).toBe("/");
    expect(pageKey("/")).toBe("/");
  });
});

describe("input cleaning", () => {
  it("keeps only clean site paths", () => {
    expect(cleanPath("/launch")).toBe("/launch");
    expect(cleanPath("/quote?x=1#y")).toBe("/quote");
    expect(cleanPath("https://x.com/")).toBeNull();
    expect(cleanPath("//x.com")).toBeNull();
    expect(cleanPath("/<script>")).toBeNull();
    expect(cleanPath(undefined)).toBeNull();
  });
  it("reduces referrers to an external host", () => {
    expect(cleanRef("https://www.google.com/search?q=x")).toBe("google.com");
    expect(cleanRef("mail.google.com")).toBe("mail.google.com");
    expect(cleanRef("https://crownmerchantfinancial.com/launch")).toBe("");
    expect(cleanRef("<b>")).toBe("");
  });
  it("flags bots and blank user agents", () => {
    expect(isBotUa("")).toBe(true);
    expect(isBotUa("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true);
    expect(isBotUa("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15")).toBe(false);
  });
});

describe("mint", () => {
  let store: ReturnType<typeof memStore>;
  beforeEach(() => { store = memStore(); });

  it("gives one random token per email, case-insensitively", async () => {
    const a = await mint(store, { email: "Jane@Example.com ", name: "Jane", source: "launch" }, T0);
    const b = await mint(store, { email: "jane@example.com", source: "other" }, T0 + 1000);
    if (a.error !== undefined || b.error !== undefined) throw new Error("mint failed");
    expect(a.token).toMatch(TOKEN_RE);
    expect(a.created).toBe(true);
    expect(b.token).toBe(a.token);
    expect(b.created).toBe(false);
    expect(b.record.source).toBe("launch"); // first campaign kept
    expect(await findToken(store, "JANE@example.com")).toBe(a.token);
  });

  it("fills a missing name later but never overwrites one", async () => {
    await mint(store, { email: "sam@example.com" }, T0);
    const b = await mint(store, { email: "sam@example.com", name: "Sam Lee" }, T0);
    const c = await mint(store, { email: "sam@example.com", name: "Someone Else" }, T0);
    if (b.error !== undefined || c.error !== undefined) throw new Error("mint failed");
    expect(b.record.name).toBe("Sam Lee");
    expect(c.record.name).toBe("Sam Lee");
  });

  it("hands the token to the lead that got the latest primer when leads share an email", async () => {
    const a = await mint(store, { email: "shared@fleet.com", lead_id: "100", source: "primer" }, T0);
    const b = await mint(store, { email: "shared@fleet.com", lead_id: "200", source: "primer" }, T0 + 1000);
    if (a.error !== undefined || b.error !== undefined) throw new Error("mint failed");
    expect(b.token).toBe(a.token);
    expect(b.record.lead_id).toBe("200");
    const c = await mint(store, { email: "shared@fleet.com" }, T0 + 2000); // a mint without a lead_id leaves it alone
    if (c.error !== undefined) throw new Error("mint failed");
    expect(c.record.lead_id).toBe("200");
  });

  it("rejects bad emails", async () => {
    expect((await mint(store, { email: "nope" }, T0)).error).toBeTruthy();
    expect(store.data.size).toBe(0);
  });

  it("ends with one token when the same new address is minted twice at once", async () => {
    const [a, b] = await Promise.all([
      mint(store, { email: "race@example.com" }, T0),
      mint(store, { email: "race@example.com" }, T0),
    ]);
    if (a.error !== undefined || b.error !== undefined) throw new Error("mint failed");
    expect(a.token).toBe(b.token);
    expect([...store.data.keys()].filter((k) => k.startsWith("tok/"))).toHaveLength(1);
    expect(await findToken(store, "race@example.com")).toBe(a.token);
  });

  it("counts a duplicated address as new only once in a batch", async () => {
    const res = await mintMany(store, [{ email: "d@x.com" }, { email: "D@x.com" }], {}, T0);
    expect(res.map((r) => (r.error === undefined ? r.created : null))).toEqual([true, false]);
  });

  it("refuses untracked pages in a batch link", async () => {
    const res = await mintMany(store, [{ email: "e@x.com", url: "/launch/login" }], { url: "/" }, T0);
    if (res[0].error !== undefined) throw new Error("mint failed");
    expect(res[0].link).toBeNull();
  });

  it("mints a batch with duplicates sharing one token, in row order", async () => {
    const res = await mintMany(
      store,
      [{ email: "a@x.com", name: "A" }, { email: "bad" }, { email: "A@x.com" }, { email: "b@x.com", url: "/quote" }],
      { source: "dec1", url: "/launch" },
      T0,
    );
    expect(res).toHaveLength(4);
    expect(res[1].error).toBeTruthy();
    const [a, , a2, b] = res;
    if (a.error !== undefined || a2.error !== undefined || b.error !== undefined) throw new Error("mint failed");
    expect(a2.token).toBe(a.token);
    expect(a.link).toBe(`https://crownmerchantfinancial.com/launch?v=${a.token}`);
    expect(b.link).toBe(`https://crownmerchantfinancial.com/quote?v=${b.token}`);
    expect([...store.data.keys()].filter((k) => k.startsWith("tok/"))).toHaveLength(2);
  });
});

describe("recordEvent", () => {
  let store: ReturnType<typeof memStore>;
  beforeEach(() => { store = memStore(); });

  it("ignores unknown tokens and bad input without writing anything", async () => {
    expect((await recordEvent(store, { t: "x".repeat(16), type: "view", p: "/" }, T0)).ok).toBe(false);
    const t = await mintToken(store);
    const before = store.data.size;
    expect((await recordEvent(store, { t, type: "click", p: "/" }, T0)).ok).toBe(false);
    expect((await recordEvent(store, { t, type: "view", p: "https://evil.com" }, T0)).ok).toBe(false);
    expect((await recordEvent(store, { t, type: "time", p: "/", s: 0 }, T0)).ok).toBe(false);
    expect((await recordEvent(store, { t: "short", type: "view", p: "/" }, T0)).ok).toBe(false);
    expect(store.data.size).toBe(before);
  });

  it("alerts on the first view of a visit, not on every page", async () => {
    const t = await mintToken(store, "jane@example.com", { name: "Jane Doe", source: "dec1" });
    const first = await recordEvent(store, { t, type: "view", p: "/launch", r: "https://mail.google.com/", device: "phone" }, T0);
    expect(first.ok).toBe(true);
    expect(first.alert).toBeTruthy();
    const second = await recordEvent(store, { t, type: "view", p: "/launch/leads" }, T0 + 2 * MIN);
    expect(second.alert).toBeNull();
    await recordEvent(store, { t, type: "time", p: "/launch/leads", s: 95 }, T0 + 4 * MIN);

    const text = alertText(first.alert!, T0);
    expect(text).toContain("Jane Doe (jane@example.com)");
    expect(text).toContain("/launch on a phone");
    expect(text).toContain("Came from: mail.google.com");
    expect(text).toContain(`#t=${t}`);

    const h = await history(store, t);
    expect(h!.summary.sessions).toBe(1);
    expect(h!.summary.views).toBe(2);
    expect(h!.summary.secs).toBe(95);
    expect(h!.events.map((e) => e.type)).toEqual(["time", "view", "view"]); // newest first
  });

  it("starts a new visit after 30 quiet minutes, alerting at most every 6 hours", async () => {
    const t = await mintToken(store);
    expect((await recordEvent(store, { t, type: "view", p: "/" }, T0)).alert).toBeTruthy();
    const back = await recordEvent(store, { t, type: "view", p: "/" }, T0 + SESSION_GAP_MS + MIN);
    expect(back.alert).toBeNull(); // new visit, but inside the cooldown
    const later = await recordEvent(store, { t, type: "view", p: "/quote" }, T0 + ALERT_COOLDOWN_MS + MIN);
    expect(later.alert).toBeTruthy();
    expect(later.alert!.summary.sessions).toBe(3);
    expect(later.alert!.sessionsThisWeek).toBe(3);
    expect(alertText(later.alert!, T0 + ALERT_COOLDOWN_MS + MIN)).toMatch(/^🔥/);
  });

  it("reports new visits and running totals for the agent app", async () => {
    const t = await mintToken(store, "lead@example.com", { name: "Lead", lead_id: "4711", source: "primer" });
    const v1 = await recordEvent(store, { t, type: "view", p: "/products/iul", device: "phone" }, T0);
    if (!v1.ok) throw new Error("not recorded");
    expect(appVisitPayload(v1, t)).toMatchObject({
      lead_id: "4711", source: "primer", new_visit: true, path: "/products/iul", sessions: 1, views: 1, secs: 0,
      pages: [{ path: "/products/iul", views: 1 }],
    });
    const time = await recordEvent(store, { t, type: "time", p: "/products/iul", s: 40 }, T0 + MIN);
    if (!time.ok) throw new Error("not recorded");
    expect(appVisitPayload(time, t)).toMatchObject({ new_visit: false, secs: 40, last_seen: T0 + MIN });
    // A new visit inside the Telegram cooldown is still a new visit for the app.
    const v2 = await recordEvent(store, { t, type: "view", p: "/" }, T0 + SESSION_GAP_MS + 2 * MIN);
    if (!v2.ok) throw new Error("not recorded");
    expect(v2.alert).toBeNull();
    expect(appVisitPayload(v2, t)).toMatchObject({ new_visit: true, sessions: 2 });
  });

  it("caps events per token per hour", async () => {
    const t = await mintToken(store);
    for (let i = 0; i < HOURLY_EVENT_CAP; i++) {
      expect((await recordEvent(store, { t, type: "time", p: "/", s: 1 }, T0 + i)).ok).toBe(true);
    }
    expect((await recordEvent(store, { t, type: "time", p: "/", s: 1 }, T0 + 5000)).reason).toBe("rate");
    expect((await recordEvent(store, { t, type: "time", p: "/", s: 1 }, T0 + 61 * MIN)).ok).toBe(true);
  });

  it("stops storing per-event records past the ceiling but keeps counting", async () => {
    const t = await mintToken(store);
    const sumKey = "sum/" + t;
    const sum = JSON.parse(store.data.get(sumKey) ?? JSON.stringify({ events: 0 }));
    store.data.set(sumKey, JSON.stringify({ ...sum, events: MAX_EVENTS_PER_TOKEN }));
    const before = [...store.data.keys()].filter((k) => k.startsWith(`ev/${t}/`)).length;
    expect((await recordEvent(store, { t, type: "view", p: "/" }, T0)).ok).toBe(true);
    expect([...store.data.keys()].filter((k) => k.startsWith(`ev/${t}/`)).length).toBe(before);
    expect((await history(store, t))!.summary.views).toBe(1);
  });

  it("clamps reported seconds", async () => {
    const t = await mintToken(store);
    await recordEvent(store, { t, type: "time", p: "/", s: 999999 }, T0);
    expect((await history(store, t))!.summary.secs).toBe(1800);
  });
});

describe("activity feed and forget", () => {
  it("lists recent people newest first and deletes everything on forget", async () => {
    const store = memStore();
    const a = await mintToken(store, "a@x.com", { name: "A" });
    const b = await mintToken(store, "b@x.com", { name: "B" });
    const c = await mintToken(store, "c@x.com"); // minted, never visited
    await recordEvent(store, { t: a, type: "view", p: "/launch" }, T0);
    await recordEvent(store, { t: b, type: "view", p: "/quote" }, T0 + 5 * MIN);
    await recordEvent(store, { t: b, type: "view", p: "/quote" }, T0 + 50 * MIN);

    const { rows, totals, truncated } = await listActivity(store, { days: 30 }, T0 + 60 * MIN);
    expect(rows.map((r) => r.name)).toEqual(["B", "A"]);
    expect(totals).toEqual({ people: 2, views: 3, hot: 1 });
    expect(truncated).toBe(false);
    const capped = await listActivity(store, { days: 30, limit: 1 }, T0 + 60 * MIN);
    expect(capped.rows).toHaveLength(1);
    expect(capped.totals.people).toBe(2);
    expect(capped.truncated).toBe(true);
    expect(rows[0]).toMatchObject({ email: "b@x.com", sessions: 2, views: 2, hot: true, topPages: [{ path: "/quote", n: 2 }] });
    expect(rows.find((r) => r.token === c)).toBeUndefined();
    expect((await listActivity(store, { days: 1 }, T0 + 3 * 86400000)).rows).toEqual([]);

    const res = await forget(store, { email: "B@x.com" });
    expect(res.token).toBe(b);
    expect([...store.data.keys()].some((k) => k.includes(b))).toBe(false);
    expect(await findToken(store, "b@x.com")).toBeNull();
    expect((await recordEvent(store, { t: b, type: "view", p: "/" }, T0 + 70 * MIN)).ok).toBe(false);
    expect(await history(store, a)).not.toBeNull();
  });
});
