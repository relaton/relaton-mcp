// Typed client for the live api.relaton.org v3 surface. Every MCP tool
// is a thin wrapper over one endpoint here — the MCP layer adds no
// semantics of its own (mirror of the api tier: discovery, not authority).
export const DEFAULT_API_BASE = "https://api.relaton.org";

export class ApiError extends Error {
  status: number;
  body: string;
  /** D1 import windows 500 every read; the API is up, the answer is "back off". */
  get retryable(): boolean {
    return this.status >= 500;
  }
  constructor(status: number, body: string) {
    super(`api.relaton.org returned ${status}`);
    this.status = status;
    this.body = body;
  }
}

export interface SearchQuery {
  q?: string;
  flavor?: string;
  year?: number;
  doctype?: string;
  status?: string;
  limit?: number;
  cursor?: string;
}

export interface ApiResult<T = unknown> {
  body: T;
  nextCursor: string | null;
}

function buildUrl(base: string, path: string, params: Record<string, string | number | undefined>): string {
  const url = new URL(path, base.endsWith("/") ? base : `${base}/`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function getJson(base: string, path: string, params: Record<string, string | number | undefined> = {}): Promise<ApiResult> {
  const res = await fetch(buildUrl(base, path, params), {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new ApiError(res.status, (await res.text()).slice(0, 2000));
  const link = res.headers.get("link");
  let nextCursor: string | null = null;
  if (link?.includes('rel="next"')) {
    const m = link.match(/cursor=([^&>]+)/);
    nextCursor = m?.[1] ?? null;
  }
  return { body: (await res.json()) as unknown, nextCursor };
}

async function getText(base: string, path: string, init?: RequestInit): Promise<string> {
  const res = await fetch(new URL(path, base.endsWith("/") ? base : `${base}/`).toString(), {
    ...init,
    headers: { accept: "text/plain", ...init?.headers },
  });
  if (!res.ok) throw new ApiError(res.status, (await res.text()).slice(0, 2000));
  return res.text();
}

export function searchDocuments(base: string, q: SearchQuery) {
  return getJson(base, "v3/documents", {
    q: q.q,
    flavor: q.flavor,
    year: q.year,
    doctype: q.doctype,
    status: q.status,
    limit: q.limit,
    cursor: q.cursor,
  });
}

export function resolveIdentifier(base: string, q: string, flavor?: string) {
  return getJson(base, "v3/resolve", { q, flavor });
}

export function getRecord(base: string, key: string, format?: "json" | "xml" | "yaml") {
  return getJson(base, `v3/documents/${encodeURIComponent(key)}`, format ? { format } : {});
}

export function getRecordText(base: string, key: string, format: "xml" | "yaml") {
  return getText(base, `v3/documents/${encodeURIComponent(key)}?format=${format}`);
}

export function getRelations(base: string, key: string, depth?: number, types?: string) {
  return getJson(base, `v3/documents/${encodeURIComponent(key)}/graph`, { depth, types });
}

export function getCitationChain(base: string, key: string) {
  return getJson(base, `v3/citations/${encodeURIComponent(key)}/chain`);
}

export function getTimeline(base: string, key: string) {
  return getJson(base, `v3/documents/${encodeURIComponent(key)}/timeline`);
}

export async function formatCitation(
  base: string,
  input: { key?: string; record?: Record<string, unknown>; style?: string; lang?: string },
): Promise<string> {
  const text = await getText(base, "v3/cite", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(input),
  });
  // The cite endpoint answers with a JSON envelope {key, style, lang, citation};
  // the tool surfaces the rendered citation itself.
  try {
    const envelope = JSON.parse(text) as { citation?: unknown };
    if (typeof envelope.citation === "string") return envelope.citation;
  } catch {
    // not JSON — return as-is
  }
  return text;
}
