import { createMcpHandler } from "agents/mcp/server";
import { env } from "cloudflare:workers";
import { createServer } from "./server.ts";
import { DEFAULT_API_BASE } from "./api.ts";

const SERVICE = "relaton-mcp";
const mcpHandler = createMcpHandler(
  () => createServer((env as { API_BASE?: string }).API_BASE ?? DEFAULT_API_BASE),
  {
  route: "/mcp",
  // The handler validates browser Origin headers and the Host of custom
  // domains against an allowlist that by default only covers localhost and
  // workers.dev — both served hostnames are listed explicitly.
  allowedHostnames: ["mcp.relaton.org", "mcp-relaton-org.relaton.workers.dev"],
});

export default {
  fetch(request: Request, _env?: unknown, ctx?: ExecutionContext): Response | Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/healthz") {
      return Response.json({ status: "ok", service: SERVICE });
    }
    const executionContext =
      ctx ?? ({ waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);
    return mcpHandler(request, env, executionContext);
  },
} satisfies ExportedHandler;
