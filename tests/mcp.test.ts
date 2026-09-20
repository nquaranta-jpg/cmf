import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, SERVER_NAME, SERVER_VERSION } from "../src/mcp/server.js";
import { QUOTE_TOOL_DESCRIPTION, BOOK_TOOL_DESCRIPTION } from "../src/mcp/config/copy.js";
import { filledRates, VERIFIED_ENV, validBooking, fakeFetch } from "./helpers.js";
import handler from "../netlify/functions/mcp.js";
import { resetRateLimits } from "../src/mcp/lib/rateLimit.js";

async function connected(logs: Record<string, unknown>[] = []) {
  const server = createMcpServer({
    quote: { rates: filledRates(), env: VERIFIED_ENV },
    book: {
      env: { BOOKER_URL: "https://example.invalid/exec", BOOKER_SECRET: "s".repeat(32) } as NodeJS.ProcessEnv,
      fetchImpl: fakeFetch({ status: "booked", start: "a", end: "b", meet_link: "c", confirmation_sent_to: "d" }).fn,
    },
    log: (e) => logs.push(e),
  });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientT);
  return { client, server };
}

describe("MCP protocol", () => {
  it("initialize returns server info and tools capability", async () => {
    const { client } = await connected();
    const info = client.getServerVersion();
    expect(info?.name).toBe(SERVER_NAME);
    expect(info?.version).toBe(SERVER_VERSION);
    expect(client.getServerCapabilities()?.tools).toBeDefined();
  });

  it("tools/list returns both tools with titles, annotations, verbatim descriptions, and schemas", async () => {
    const { client } = await connected();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["book_consultation", "get_quote_estimate"]);
    const quote = tools.find((t) => t.name === "get_quote_estimate")!;
    expect(quote.title).toBe("Life Insurance Quote Estimate");
    expect(quote.description).toBe(QUOTE_TOOL_DESCRIPTION);
    expect(quote.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    expect(quote.inputSchema.properties).toHaveProperty("age");
    expect(quote.inputSchema.required).toEqual(expect.arrayContaining(["age", "state", "tobacco", "product_type"]));
    const book = tools.find((t) => t.name === "book_consultation")!;
    expect(book.title).toBe("Book a Life Insurance Consultation");
    expect(book.description).toBe(BOOK_TOOL_DESCRIPTION);
    expect(book.annotations).toEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true });
    expect(book.inputSchema.required).toEqual(expect.arrayContaining(["first_name", "last_name", "email", "phone", "state", "preferred_start", "consent_to_contact"]));
  });

  it("tools/call get_quote_estimate returns structured content and logs only safe fields", async () => {
    const logs: Record<string, unknown>[] = [];
    const { client } = await connected(logs);
    const res = await client.callTool({ name: "get_quote_estimate", arguments: { age: 35, state: "IL", tobacco: false, product_type: "term", coverage_amount: 500000, term_years: 20 } });
    expect(res.isError).toBeFalsy();
    expect((res.structuredContent as { status: string }).status).toBe("estimate");
    expect(logs[0]).toEqual({ tool: "get_quote_estimate", status: "estimate", state: "IL", ms: expect.any(Number) });
  });

  it("tools/call returns a tool error (not a protocol error) for a bad range", async () => {
    const { client } = await connected();
    const res = await client.callTool({ name: "get_quote_estimate", arguments: { age: 17, state: "IL", tobacco: false, product_type: "term", coverage_amount: 500000 } });
    expect(res.isError).toBe(true);
    expect((res.content as { text: string }[])[0].text).toMatch(/age/);
  });

  it("tools/call book_consultation works and never logs PII", async () => {
    const logs: Record<string, unknown>[] = [];
    const { client } = await connected(logs);
    const res = await client.callTool({ name: "book_consultation", arguments: validBooking() });
    expect((res.structuredContent as { status: string }).status).toBe("booked");
    const logText = JSON.stringify(logs);
    expect(logText).not.toMatch(/example\.com|555|Test|Person/);
    expect(logs[0]).toMatchObject({ tool: "book_consultation", status: "booked", state: "IL" });
  });
});

describe("Netlify handler", () => {
  const ctx = { ip: "203.0.113.9" };
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    handler(new Request("https://crownmerchantfinancial.com/mcp", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }), ctx);

  it("GET /mcp/health returns ok + version", async () => {
    const res = await handler(new Request("https://crownmerchantfinancial.com/mcp/health"), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: SERVER_VERSION });
  });
  it("GET /mcp returns 405", async () => {
    const res = await handler(new Request("https://crownmerchantfinancial.com/mcp"), ctx);
    expect(res.status).toBe(405);
  });
  it("OPTIONS returns CORS headers", async () => {
    const res = await handler(new Request("https://crownmerchantfinancial.com/mcp", { method: "OPTIONS" }), ctx);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
  it("initialize and tools/list over HTTP with a JSON-only Accept header", async () => {
    resetRateLimits();
    const init = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } }, { Accept: "application/json" });
    expect(init.status).toBe(200);
    const body = await init.json();
    expect(body.result.serverInfo.name).toBe(SERVER_NAME);
    const list = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const listBody = await list.json();
    expect(listBody.result.tools.length).toBe(2);
  });
  it("rejects invalid JSON with a parse error", async () => {
    const res = await handler(new Request("https://crownmerchantfinancial.com/mcp", { method: "POST", body: "{nope" }), ctx);
    expect(res.status).toBe(400);
  });
  it("rate limits booking calls at 5 per 10 minutes per IP", async () => {
    resetRateLimits();
    const call = () => post({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "book_consultation", arguments: { ...validBooking(), consent_to_contact: false } } });
    for (let i = 0; i < 5; i++) expect((await call()).status).toBe(200);
    const blocked = await call();
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    const other = await handler(new Request("https://crownmerchantfinancial.com/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }), { ip: "198.51.100.1" });
    expect(other.status).toBe(200);
  });
});
