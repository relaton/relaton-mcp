# relaton-mcp

Relaton MCP server — Model Context Protocol access to the Relaton Index.

Epic: relaton/relaton-api-js#175 (Week 4). Implementation charter lives in this
repo's issue tracker.

## What this service does

Exposes the Relaton Index (api.relaton.org v3) to AI agents over MCP:

- Tools:
  - `search` — corpus search (q, flavor, year, doctype, status, limit, cursor)
  - `resolve` — any identifier string → parsed components + ranked canonical candidates
  - `get_record` — full bibliographic record by corpus key (json / xml / yaml)
  - `get_relations` — typed relation graph around a document (depth, types)
  - `get_citation_chain` — edition chain along the structural relation types
  - `get_timeline` — classified, date-ordered publication-history events
  - `format_citation` — any record/key → ISO 690, Chicago, APA, MLA, BibTeX, RIS, CSL-JSON
- Transport: stateless Streamable HTTP at `/mcp` (`createMcpHandler`,
  agents SDK + MCP SDK v2 — no session, no Durable Object)
- OAuth: deferred (read-only MVP); the handler supports an
  `OAuthProvider` wrapper when the owner registers the OAuth app

The killer pair for agents: pubid identifier resolution (any id string →
canonical candidates) and citation formatting (any record → correct citation
in seven styles).

Client configuration:

```json
{
  "mcpServers": {
    "relaton": { "url": "https://mcp.relaton.org/mcp" }
  }
}
```

## Cloudflare deployment

- Worker: `mcp-relaton-org` (`wrangler.jsonc`)
- Route: `mcp.relaton.org` (custom domain, live)
- `API_BASE` points at the API's workers.dev hostname, not the zone:
  Cloudflare edge bot mitigation 403s worker→worker subrequests that
  traverse the relaton.org zone, while external clients on api.relaton.org
  are unaffected. A service binding (`services` → `api-relaton-org`) is
  the owner-side hardening option if the workers.dev lane ever needs to
  disappear.
- GitHub secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- Wrangler secrets (owner-side): OAuth app credentials
- Registry listing in the MCP registry after first deploy

## Laws (binding)

- LML-first SSOT: data and wire shapes derive from relaton-models; no
  hand-rolled serialization.
- pubid is the identifier authority: resolution goes through the @pubid
  engines; never hand-roll parsing.
- API-tier semantics: resolve returns candidates (discovery), never
  authoritative answers.

## Development

```sh
npm install
npm run dev      # local workerd
npm test         # vitest
npm run deploy   # requires CF secrets
```
