import { describe, expect, it, vi, afterEach } from "vitest";
import { createMcpHandler } from "agents/mcp/server";
import { createServer } from "../src/server.ts";
import { withHost } from "./request.ts";

// Full-protocol tests: the stateless createMcpHandler pattern runs on plain
// node (AsyncLocalStorage is standard), so the JSON-RPC surface is driven
// through the same handler the Worker serves at /mcp. Fetch is stubbed, so
// the tool layer is exercised without api.relaton.org.
afterEach(() => {
  vi.unstubAllGlobals();
});

const REQ = (id: number, method: string, params?: unknown) =>
  withHost(
    new Request("http://localhost:8787/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }),
    }),
    "localhost:8787",
  );

const NULL_CTX = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

async function rpc(handler: ReturnType<typeof createMcpHandler>, id: number, method: string, params?: unknown) {
  const res = await handler(REQ(id, method, params), {}, NULL_CTX);
  expect(res.status).toBe(200);
  const text = await res.text();
  // With an SSE-capable Accept header the handler answers as an SSE stream;
  // the JSON-RPC reply rides the first `data:` frame.
  const frame = text.split("\n").find((l) => l.startsWith("data:"));
  return JSON.parse(frame!.slice(5).trim()) as { result: Record<string, unknown>; error?: unknown };
}

function stubApi(payload: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(typeof payload === "string" ? payload : JSON.stringify(payload), { status })),
  );
}

describe("relaton MCP server", () => {
  it("answers initialize with the server identity", async () => {
    const handler = createMcpHandler(() => createServer("https://api.relaton.org"));
    const { result } = await rpc(handler, 1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "vitest", version: "0" },
    });
    const info = result.serverInfo as { name: string; version: string };
    expect(info.name).toBe("relaton-mcp");
    expect(info.version).toBe("0.1.0");
  });

  it("lists the seven corpus tools", async () => {
    const handler = createMcpHandler(() => createServer("https://api.relaton.org"));
    const { result } = await rpc(handler, 2, "tools/list");
    const names = (result.tools as { name: string }[]).map((t) => t.name);
    expect(names).toEqual([
      "search",
      "resolve",
      "get_record",
      "get_relations",
      "get_citation_chain",
      "get_timeline",
      "format_citation",
    ]);
  });

  it("search tool returns the corpus page as text", async () => {
    stubApi({ items: [{ key: "iso-9001-2015", title: "Quality management systems" }], has_more: false });
    const handler = createMcpHandler(() => createServer("https://api.relaton.org"));
    const { result } = await rpc(handler, 3, "tools/call", {
      name: "search",
      arguments: { q: "quality", flavor: "iso", limit: 1 },
    });
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toContain("iso-9001-2015");
    const url = (vi.mocked(globalThis.fetch).mock.calls[0] as unknown as [string])[0];
    expect(new URL(url).searchParams.get("flavor")).toBe("iso");
    expect(result.isError).toBeUndefined();
  });

  it("resolve tool surfaces parsed components and candidates", async () => {
    stubApi({ input: "ISO 9001:2015", parse_ok: true, candidates: [{ key: "iso-9001-2015", match: "exact" }] });
    const handler = createMcpHandler(() => createServer("https://api.relaton.org"));
    const { result } = await rpc(handler, 4, "tools/call", {
      name: "resolve",
      arguments: { q: "ISO 9001:2015" },
    });
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toContain("parse_ok");
    expect(text).toContain("iso-9001-2015");
  });

  it("get_record tool returns the full record", async () => {
    stubApi({ key: "iso-9001-2015", docid: "ISO 9001:2015" });
    const handler = createMcpHandler(() => createServer("https://api.relaton.org"));
    const { result } = await rpc(handler, 5, "tools/call", {
      name: "get_record",
      arguments: { key: "iso-9001-2015" },
    });
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toContain("ISO 9001:2015");
  });

  it("format_citation without key or record reports a usage error, not a crash", async () => {
    stubApi({}, 500);
    const handler = createMcpHandler(() => createServer("https://api.relaton.org"));
    const { result } = await rpc(handler, 6, "tools/call", {
      name: "format_citation",
      arguments: { style: "bibtex" },
    });
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toContain("key");
    expect(result.isError).toBeUndefined();
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(0);
  });

  it("API failures surface as tool errors with the status", async () => {
    stubApi('{"title":"Not Found","status":404}', 404);
    const handler = createMcpHandler(() => createServer("https://api.relaton.org"));
    const { result } = await rpc(handler, 7, "tools/call", {
      name: "get_record",
      arguments: { key: "does-not-exist" },
    });
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(result.isError).toBe(true);
    expect(text).toContain("404");
    expect(text).not.toContain("retry");
  });

  it("import-window 500s tell the agent to retry instead of looking like an outage", async () => {
    stubApi("Internal server error: D1_ERROR: Currently processing a long-running import.", 500);
    const handler = createMcpHandler(() => createServer("https://api.relaton.org"));
    const { result } = await rpc(handler, 8, "tools/call", {
      name: "get_record",
      arguments: { key: "ISO 9001:2015" },
    });
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(result.isError).toBe(true);
    expect(text).toContain("retry in ~1 minute");
  });
});
