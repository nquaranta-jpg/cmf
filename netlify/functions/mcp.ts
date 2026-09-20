// Hosted MCP server for AI agents (Meta Muse first). Streamable HTTP in
// stateless mode: a fresh server + transport per request, no session ids.
//
// Routes (Netlify Functions v2, see `config` below):
//   POST /mcp          JSON-RPC (initialize, tools/list, tools/call)
//   GET  /mcp          405, SSE streaming is not offered in stateless mode
//   GET  /mcp/health   { ok: true, version }
//
// Env: BOOKER_URL, BOOKER_SECRET, RATES_VERIFIED. See src/mcp for the tools.

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer, SERVER_VERSION } from "../../src/mcp/server.js";
import { checkRateLimit, type LimitName } from "../../src/mcp/lib/rateLimit.js";
import { MSG_RATE_LIMITED } from "../../src/mcp/config/copy.js";

const MAX_BODY_BYTES = 64 * 1024;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

type NetlifyContext = { ip?: string };

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  headers.set("Cache-Control", "no-store");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return withCors(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...extra },
    }),
  );
}

function rpcError(status: number, code: number, message: string, id: unknown = null, extra: Record<string, string> = {}): Response {
  return json(status, { jsonrpc: "2.0", error: { code, message }, id }, extra);
}

function clientIp(req: Request, context: NetlifyContext): string {
  return (
    context?.ip ||
    req.headers.get("x-nf-client-connection-ip") ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown"
  );
}

/** Which rate-limit bucket a JSON-RPC body falls into. */
function limitFor(body: unknown): LimitName {
  const msgs = Array.isArray(body) ? body : [body];
  let name: LimitName = "other";
  for (const m of msgs) {
    if (m && typeof m === "object" && (m as { method?: string }).method === "tools/call") {
      const tool = (m as { params?: { name?: string } }).params?.name;
      if (tool === "book_consultation") return "book";
      if (tool === "get_quote_estimate") name = "quote";
    }
  }
  return name;
}

export default async function handler(req: Request, context: NetlifyContext): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (req.method === "OPTIONS") {
    return withCors(new Response(null, { status: 204 }));
  }

  if (path === "/mcp/health") {
    return json(200, { ok: true, version: SERVER_VERSION });
  }

  if (req.method === "GET" || req.method === "DELETE") {
    // Stateless mode: no server-initiated SSE stream and nothing to delete.
    return rpcError(405, -32000, "Method not allowed. POST JSON-RPC messages to /mcp.", null, { Allow: "POST, OPTIONS" });
  }

  if (req.method !== "POST") {
    return rpcError(405, -32000, "Method not allowed.", null, { Allow: "POST, OPTIONS" });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return rpcError(413, -32000, "Request body too large.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return rpcError(400, -32700, "Parse error: body must be JSON.");
  }

  const ip = clientIp(req, context);
  const limit = checkRateLimit(ip, limitFor(parsed));
  if (!limit.allowed) {
    const id = (parsed as { id?: unknown })?.id ?? null;
    return rpcError(429, -32000, MSG_RATE_LIMITED, id, { "Retry-After": String(limit.retryAfterSec) });
  }

  // We always answer with JSON, so accept clients that only advertise JSON.
  const headers = new Headers(req.headers);
  headers.set("Accept", "application/json, text/event-stream");
  headers.set("Content-Type", "application/json");
  const inner = new Request(req.url, { method: "POST", headers, body: raw });

  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    const res = await transport.handleRequest(inner);
    return withCors(res);
  } catch (err) {
    console.error(JSON.stringify({ src: "mcp", status: "server_error", message: err instanceof Error ? err.message : "unknown" }));
    return rpcError(500, -32603, "Internal error.");
  } finally {
    // Do not await: the response is already built. Closing frees the server.
    void transport.close().catch(() => undefined);
    void server.close().catch(() => undefined);
  }
}

export const config = {
  path: ["/mcp", "/mcp/health"],
};
