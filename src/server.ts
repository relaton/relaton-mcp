import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  ApiError,
  DEFAULT_API_BASE,
  getCitationChain,
  getRecord,
  getRecordText,
  getRelations,
  getTimeline,
  formatCitation,
  resolveIdentifier,
  searchDocuments,
} from "./api.ts";

// Stateless MCP server factory (agents/mcp/server createMcpHandler pattern):
// every request gets a fresh McpServer; tools are pure reads against the
// api.relaton.org v3 surface, formatted for an LLM consumer as JSON text.
export function createServer(base: string = DEFAULT_API_BASE): McpServer {
  const server = new McpServer({ name: "relaton-mcp", version: "0.1.0" });

  const run = async (
    fn: () => Promise<string>,
  ): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> => {
    try {
      return { content: [{ type: "text", text: await fn() }] };
    } catch (e) {
      let detail: string;
      let hint = "";
      if (e instanceof ApiError) {
        detail = `status ${e.status}: ${e.body}`;
        // relaton-api-js#190: D1 import windows 500 every read route; tell the
        // agent this is temporary instead of surfacing a bare server error.
        if (e.retryable) hint = " — the API is temporarily serving errors; retry in ~1 minute";
      } else {
        detail = e instanceof Error ? e.message : String(e);
      }
      return {
        isError: true,
        content: [{ type: "text", text: `API request failed (${detail})${hint}` }],
      };
    }
  };

  const json = (v: unknown) => JSON.stringify(v, null, 2);

  server.registerTool(
    "search",
    {
      description:
        "Search the Relaton bibliographic corpus (100+ SDO flavors: ISO, IEC, ITU, IEEE, NIST, BIPM, OGC, ...). " +
        "Free-text and field filters; matches titles and document identifiers.",
      inputSchema: {
        q: z.string().describe("Query text: a title fragment or a document identifier like 'ISO 9001:2015'"),
        flavor: z.string().optional().describe("Restrict to one data flavor, e.g. 'iso', 'ieee', 'nist'"),
        year: z.number().int().optional().describe("Publication year filter"),
        doctype: z.string().optional().describe("Document type filter, e.g. 'standard', 'technical-report'"),
        status: z.string().optional().describe("Publication status filter, e.g. 'published', 'withdrawn'"),
        limit: z.number().int().min(1).max(100).optional().describe("Page size (1-100, default 25)"),
        cursor: z.string().optional().describe("Opaque cursor from a previous page's next_cursor"),
      },
    },
    async (args) =>
      run(async () => {
        const { body, nextCursor } = await searchDocuments(base, args);
        return json({ next_cursor: nextCursor, ...(body as Record<string, unknown>) });
      }),
  );

  server.registerTool(
    "resolve",
    {
      description:
        "Resolve a bibliographic identifier to parsed components plus ranked canonical candidates. " +
        "Use this when the exact corpus key is unknown; returns the best-matching documents with their keys.",
      inputSchema: {
        q: z.string().describe("Identifier string, e.g. 'ISO 9001:2015', 'ITU-T G.989.2', 'IEEE 802.3'"),
        flavor: z.string().optional().describe("Hint the identifier's SDO flavor to bias parsing"),
      },
    },
    async ({ q, flavor }) =>
      run(async () => {
        const { body } = await resolveIdentifier(base, q, flavor);
        return json(body);
      }),
  );

  server.registerTool(
    "get_record",
    {
      description:
        "Fetch the full bibliographic record for a corpus key (from search or resolve): identifiers, titles, dates, " +
        "abstract, relations, in Relaton's YAML-semantic JSON shape.",
      inputSchema: {
        key: z.string().describe("Corpus key, e.g. 'iso-9001-2015'"),
        format: z.enum(["json", "xml", "yaml"]).optional().describe("Response format (default json)"),
      },
    },
    async ({ key, format }) =>
      run(async () => {
        if (format === "xml" || format === "yaml") return getRecordText(base, key, format);
        const { body } = await getRecord(base, key);
        return json(body);
      }),
  );

  server.registerTool(
    "get_relations",
    {
      description:
        "Fetch the typed relation graph around a document: nodes (related documents, external targets) and edges " +
        "(amends, updates, supersedes, adoptedFrom, ...). Walk the citation network around a standard.",
      inputSchema: {
        key: z.string().describe("Corpus key"),
        depth: z.number().int().min(1).max(4).optional().describe("Traversal depth 1-4 (default 1)"),
        types: z.string().optional().describe("Comma-separated relation types to keep, e.g. 'amends,updates'"),
      },
    },
    async ({ key, depth, types }) =>
      run(async () => {
        const { body } = await getRelations(base, key, depth, types);
        return json(body);
      }),
  );

  server.registerTool(
    "get_citation_chain",
    {
      description:
        "Fetch the edition chain of a document: its ancestors and descendants along the structural relation types " +
        "(amends/updates/corrigends), date-ordered. Answers 'which edition is current?'",
      inputSchema: {
        key: z.string().describe("Corpus key"),
      },
    },
    async ({ key }) =>
      run(async () => {
        const { body } = await getCitationChain(base, key);
        return json(body);
      }),
  );

  server.registerTool(
    "get_timeline",
    {
      description:
        "Fetch the full publication history of a document as classified date-ordered events: publication, amendments, " +
        "corrigenda, supersedence, obsolescence, adoptions — inbound and outbound edges.",
      inputSchema: {
        key: z.string().describe("Corpus key"),
      },
    },
    async ({ key }) =>
      run(async () => {
        const { body } = await getTimeline(base, key);
        return json(body);
      }),
  );

  server.registerTool(
    "format_citation",
    {
      description:
        "Render a citation string for a document in a bibliography style: ISO 690 (default), Chicago, APA, MLA, " +
        "BibTeX, RIS, or CSL-JSON. Give a corpus key, or an inline Relaton record.",
      inputSchema: {
        key: z.string().optional().describe("Corpus key of the record to cite"),
        record: z.record(z.string(), z.unknown()).optional().describe("Inline Relaton record (use when the document is not in the corpus)"),
        style: z
          .enum(["iso690", "chicago", "apa", "mla", "bibtex", "ris", "csl-json"])
          .optional()
          .describe("Citation style (default iso690)"),
        lang: z.string().optional().describe("Render language, e.g. 'en', 'ja'"),
      },
    },
    async (args) =>
      run(async () => {
        if (!args.key && !args.record) {
          return "Either 'key' or 'record' is required.";
        }
        return formatCitation(base, args);
      }),
  );

  return server;
}
