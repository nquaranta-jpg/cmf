// Builds a fresh McpServer with both CMF tools registered. Called once per
// request by the Netlify function (stateless mode) and directly by tests.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  AGENCY_NAME,
  BOOK_TOOL_DESCRIPTION,
  BOOK_TOOL_TITLE,
  QUOTE_TOOL_DESCRIPTION,
  QUOTE_TOOL_TITLE,
} from "./config/copy.js";
import { getQuoteEstimate, quoteInputShape, type QuoteDeps } from "./tools/quote.js";
import { bookConsultation, bookInputShape, type BookDeps } from "./tools/book.js";

export const SERVER_NAME = "crown-merchant-financial";
export const SERVER_VERSION = "1.0.0";

export type ServerDeps = { quote?: QuoteDeps; book?: BookDeps; log?: (entry: Record<string, unknown>) => void };

/** Logs tool name, status, state, and latency only. Never PII, never the secret. */
function defaultLog(entry: Record<string, unknown>) {
  console.log(JSON.stringify({ src: "mcp", ...entry }));
}

function okResult(payload: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as Record<string, unknown>,
  };
}

function errResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

export function createMcpServer(deps: ServerDeps = {}): McpServer {
  const log = deps.log ?? defaultLog;
  const server = new McpServer(
    { name: SERVER_NAME, title: AGENCY_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "get_quote_estimate",
    {
      title: QUOTE_TOOL_TITLE,
      description: QUOTE_TOOL_DESCRIPTION,
      inputSchema: quoteInputShape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      const t0 = Date.now();
      const out = getQuoteEstimate(args, deps.quote);
      const status = "error" in out ? "validation_error" : out.result.status;
      const state = "error" in out ? undefined : out.result.inputs_echo.state;
      log({ tool: "get_quote_estimate", status, state, ms: Date.now() - t0 });
      return "error" in out ? errResult(out.error) : okResult(out.result);
    },
  );

  server.registerTool(
    "book_consultation",
    {
      title: BOOK_TOOL_TITLE,
      description: BOOK_TOOL_DESCRIPTION,
      inputSchema: bookInputShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      const t0 = Date.now();
      const out = await bookConsultation(args, deps.book);
      const status = "error" in out ? "validation_error" : out.result.status;
      const state = typeof (args as { state?: unknown })?.state === "string" ? String((args as { state: string }).state).toUpperCase().slice(0, 2) : undefined;
      log({ tool: "book_consultation", status, state, ms: Date.now() - t0 });
      return "error" in out ? errResult(out.error) : okResult(out.result);
    },
  );

  return server;
}
