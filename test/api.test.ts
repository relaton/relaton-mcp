import { describe, expect, it, vi, afterEach } from "vitest";
import {
  ApiError,
  formatCitation,
  getCitationChain,
  getRecord,
  getRelations,
  getTimeline,
  resolveIdentifier,
  searchDocuments,
} from "../src/api.ts";

const BASE = "https://api.relaton.org";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push({ url, init });
      return handler(url, init);
    }),
  );
  return calls;
}

describe("api client", () => {
  it("search passes filters as query params and parses the next cursor from Link", async () => {
    const calls = stubFetch(
      () =>
        new Response(JSON.stringify({ items: [] }), {
          headers: {
            link: '<https://api.relaton.org/v3/documents?q=x&cursor=abc123>; rel="next"',
          },
        }),
    );
    const res = await searchDocuments(BASE, { q: "9001", flavor: "iso", limit: 5, year: undefined });
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/v3/documents");
    expect(url.searchParams.get("q")).toBe("9001");
    expect(url.searchParams.get("flavor")).toBe("iso");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.has("year")).toBe(false);
    expect(res.nextCursor).toBe("abc123");
  });

  it("resolve hits the resolve endpoint", async () => {
    const calls = stubFetch(() => new Response(JSON.stringify({ parse_ok: true }), {}));
    const { body } = await resolveIdentifier(BASE, "ISO 9001:2015", "iso");
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/v3/resolve");
    expect(url.searchParams.get("q")).toBe("ISO 9001:2015");
    expect(url.searchParams.get("flavor")).toBe("iso");
    expect(body).toEqual({ parse_ok: true });
  });

  it("record/graph/chain/timeline encode the key into the path", async () => {
    stubFetch(() => new Response("{}", {}));
    for (const [fn, path] of [
      [getRecord, "/v3/documents/iso%209001-2015"],
      [(b: string, k: string) => getRelations(b, k), "/v3/documents/iso%209001-2015/graph"],
      [getCitationChain, "/v3/citations/iso%209001-2015/chain"],
      [getTimeline, "/v3/documents/iso%209001-2015/timeline"],
    ] as const) {
      const calls = stubFetch(() => new Response("{}", {}));
      await fn(BASE, "iso 9001-2015");
      expect(new URL(calls[0]!.url).pathname).toBe(path);
    }
  });

  it("getRecord passes format json through the query", async () => {
    const calls = stubFetch(() => new Response("{}", {}));
    await getRecord(BASE, "iso-9001-2015", "yaml");
    expect(new URL(calls[0]!.url).searchParams.get("format")).toBe("yaml");
  });

  it("formatCitation POSTs the style input as JSON and unwraps the citation envelope", async () => {
    const calls = stubFetch(
      () =>
        new Response(
          JSON.stringify({ key: "ISO 9001:2015", style: "bibtex", lang: null, citation: "@misc{ISO90012015, title = {x}}" }),
          {},
        ),
    );
    const text = await formatCitation(BASE, { key: "ISO 9001:2015", style: "bibtex" });
    expect(text).toContain("@misc");
    expect(text).not.toContain("citation");
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/v3/cite");
    expect(url.host).toBe("api.relaton.org");
    const init = calls[0]!.init!;
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ key: "ISO 9001:2015", style: "bibtex" });
  });

  it("formatCitation passes through a plain-text body unchanged", async () => {
    stubFetch(() => new Response("@misc{iso9001, title = {x}}", {}));
    const text = await formatCitation(BASE, { key: "iso-9001-2015", style: "bibtex" });
    expect(text).toContain("@misc{iso9001");
  });

  it("raises ApiError with the status and body on a non-2xx response", async () => {
    stubFetch(() => new Response('{"title":"Not Found"}', { status: 404 }));
    const err = await getRecord(BASE, "nope").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).body).toContain("Not Found");
  });
});
