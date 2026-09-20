import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as copy from "../src/mcp/config/copy.js";

// Common life carriers. Extend if a new one shows up in the marketing materials.
const CARRIER_NAMES = [
  "Mutual of Omaha", "Americo", "Transamerica", "Foresters", "Aetna", "Gerber", "AIG", "Corebridge", "Prudential",
  "Banner Life", "Legal & General", "Protective Life", "Lincoln Financial", "John Hancock", "Nationwide", "Ethos", "Ladder", "Haven Life",
  "SBLI", "Pacific Life", "North American", "Royal Neighbors", "American Amicable", "Liberty Bankers", "CICA",
  "Fidelity & Guaranty", "F&G", "Allianz", "Athene", "National Life", "Symetra", "Assurity", "Great Western",
  "Columbian", "Baltimore Life", "Aflac", "Globe Life", "Colonial Penn", "Lumico", "Sagicor", "Bestow", "MassMutual",
  "Northwestern Mutual", "New York Life", "State Farm", "Allstate", "Guardian", "Penn Mutual", "Ameritas", "Securian",
  "Minnesota Life", "Principal", "Brighthouse", "Equitable", "Illinois Mutual", "Kansas City Life", "Occidental",
];
const BANNED_PHRASES = [/guaranteed/i, /best rates?/i, /lowest price/i, /cash value growth/i, /\d+% (return|growth)/i, /rate of return/i];
const EM_DASH = /—/;

const files: Record<string, string> = {
  "copy.ts (all exported strings)": (Object.values(copy).filter((v) => typeof v === "string") as string[]).join("\n"),
  "connect/muse/index.html": readFileSync("connect/muse/index.html", "utf8"),
  "directories/muse/SUBMISSION.md": readFileSync("directories/muse/SUBMISSION.md", "utf8"),
  "apps-script/CMF_Muse_Booker.gs": readFileSync("apps-script/CMF_Muse_Booker.gs", "utf8"),
  "terms.html": readFileSync("terms.html", "utf8"),
};

describe("compliance copy", () => {
  for (const [name, text] of Object.entries(files)) {
    it(`${name} has no em dashes`, () => {
      const lines = text.split("\n").map((l, i) => [i + 1, l] as const).filter(([, l]) => EM_DASH.test(l));
      expect(lines.map(([n]) => n), `em dash on lines ${lines.map(([n]) => n).join(", ")}`).toEqual([]);
    });
    it(`${name} has no carrier names`, () => {
      const hits = CARRIER_NAMES.filter((c) => new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
      expect(hits).toEqual([]);
    });
    it(`${name} has no banned claims`, () => {
      const hits = BANNED_PHRASES.filter((re) => re.test(text)).map(String);
      expect(hits).toEqual([]);
    });
  }
  it("tool descriptions match the spec verbatim", () => {
    expect(copy.QUOTE_TOOL_DESCRIPTION).toBe(
      "Returns an estimated monthly premium range for life insurance from Crown Merchant Financial, a licensed independent life insurance agency. Estimates only, not an offer of coverage. Always show the user the disclaimer returned with the result. If the user wants exact pricing or wants to apply, offer to book a free consultation with the book_consultation tool.",
    );
    expect(copy.BOOK_TOOL_DESCRIPTION.startsWith("Books a free 20-minute video consultation with a licensed agent at Crown Merchant Financial.")).toBe(true);
    expect(copy.BOOK_TOOL_DESCRIPTION).toContain(copy.CONSENT_TEXT);
    expect(copy.CONSENT_VERSION).toBe("CONSENT_V1");
  });
  it("the docs page carries the disclaimer, the endpoint, the support email and phone", () => {
    const page = files["connect/muse/index.html"];
    expect(page).toContain(copy.DISCLAIMER);
    expect(page).toContain("https://crownmerchantfinancial.com/mcp");
    expect(page).toContain(copy.SUPPORT_EMAIL);
    expect(page).toContain(copy.SUPPORT_PHONE);
    expect(page).toMatch(/href="\/privacy"/);
    expect(page).toMatch(/href="\/terms"/);
  });
  it("the Apps Script embeds the same disclaimer and consent version", () => {
    const gs = files["apps-script/CMF_Muse_Booker.gs"];
    expect(gs).toContain(copy.DISCLAIMER);
    expect(gs).toContain("CONSENT_V1");
  });
});
