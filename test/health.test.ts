import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));

import worker from "../src/index";
import { withHost } from "./request.ts";

describe("health", () => {
  it("reports ok", async () => {
    const res = await worker.fetch(new Request("https://mcp.relaton.org/healthz"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", service: "relaton-mcp" });
  });

  it("routes non-health paths to the MCP handler", async () => {
    const res = await worker.fetch(
      withHost(new Request("http://mcp.relaton.org/mcp", { method: "GET" }), "mcp.relaton.org"),
    );
    expect(res.status).not.toBe(404);
  });
});
