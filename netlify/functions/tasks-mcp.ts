// CMF Task Board MCP server for AI agents. Streamable HTTP, stateless: a
// fresh server + transport per request (same shape as mcp.ts).
//
//   POST /tasks/mcp          JSON-RPC (initialize, tools/list, tools/call)
//   GET  /tasks/mcp/health   { ok: true, version }
//
// The worker key rides in `Authorization: Bearer cmfw_...`. Data lives in the
// "taskboard" Netlify Blobs store. See src/tasks/server.ts for the tools.

import { getStore } from "@netlify/blobs";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createTaskServer, TASKS_SERVER_VERSION } from "../../src/tasks/server.js";
import { sendTelegram, sendPayoutSetupEmail } from "./lib/taskboard.mjs";
import { makeStripe } from "./lib/stripe.mjs";

const MAX_BODY_BYTES = 32 * 1024;
const WINDOW_MS = 60_000;
const PER_MINUTE = 60;
const REGISTER_PER_HOUR = 5;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

// Per-instance limiter: good enough to blunt a runaway agent loop.
const hits = new Map<string, number[]>();
function limited(bucket: string, max: number, windowMs: number, now: number): boolean {
  const recent = (hits.get(bucket) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(bucket, recent);
    return true;
  }
  recent.push(now);
  hits.set(bucket, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  headers.set("Cache-Control", "no-store");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return withCors(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...extra } }));
}

function rpcError(status: number, code: number, message: string, id: unknown = null, extra: Record<string, string> = {}) {
  return json(status, { jsonrpc: "2.0", error: { code, message }, id }, extra);
}

function isRegister(body: unknown): boolean {
  const msgs = Array.isArray(body) ? body : [body];
  return msgs.some((m) => m?.method === "tools/call" && m?.params?.name === "register_worker");
}

export default async function handler(req: Request, context: { ip?: string }): Promise<Response> {
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  if (req.method === "OPTIONS") return withCors(new Response(null, { status: 204 }));
  if (path === "/tasks/mcp/health") return json(200, { ok: true, version: TASKS_SERVER_VERSION });
  if (req.method !== "POST") return rpcError(405, -32000, "Method not allowed. POST JSON-RPC messages to /tasks/mcp.", null, { Allow: "POST, OPTIONS" });

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return rpcError(413, -32000, "Request body too large.");
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return rpcError(400, -32700, "Parse error: body must be JSON.");
  }

  const ip = context?.ip || req.headers.get("x-nf-client-connection-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const now = Date.now();
  if (limited(`ip:${ip}`, PER_MINUTE, WINDOW_MS, now) || (isRegister(parsed) && limited(`reg:${ip}`, REGISTER_PER_HOUR, 3_600_000, now))) {
    return rpcError(429, -32000, "Too many requests. Slow down and retry in a minute.", parsed?.id ?? null, { "Retry-After": "60" });
  }

  const auth = req.headers.get("authorization") || "";
  const bearer = /^Bearer\s+(\S+)$/i.exec(auth)?.[1] || null;

  const headers = new Headers(req.headers);
  headers.set("Accept", "application/json, text/event-stream");
  headers.set("Content-Type", "application/json");
  const inner = new Request(req.url, { method: "POST", headers, body: raw });

  const server = createTaskServer({
    store: getStore({ name: "taskboard", consistency: "strong" }) as any,
    bearer,
    notify: sendTelegram,
    stripe: makeStripe(),
    emailPayoutLink: sendPayoutSetupEmail,
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    return withCors(await transport.handleRequest(inner));
  } catch (err) {
    console.error(JSON.stringify({ src: "tasks-mcp", status: "server_error", message: err instanceof Error ? err.message : "unknown" }));
    return rpcError(500, -32603, "Internal error.");
  } finally {
    void transport.close().catch(() => undefined);
    void server.close().catch(() => undefined);
  }
}

export const config = { path: ["/tasks/mcp", "/tasks/mcp/health"] };
