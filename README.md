# relaton-mcp

Relaton MCP server — Model Context Protocol access to the Relaton Index.

Epic: relaton/relaton-api-js#175 (Week 4). Implementation charter lives in this
repo's issue tracker.

## What this service does

Exposes the Relaton Index (api.relaton.org v3) to AI agents over MCP:

- Tools: `search`, `resolve`, `get_record`, `get_relations`,
  `get_citation_chain`, `format_citation`
- Resources: `relaton://records/{key}`
- Transport: Streamable HTTP + OAuth (Workers agents SDK)

The killer pair for agents: pubid identifier resolution (any id string →
canonical candidates) and citation formatting (any record → correct citation
in seven styles).

## Cloudflare deployment

- Worker: `mcp-relaton-org` (`wrangler.jsonc`)
- Route: `mcp.relaton.org` (custom domain, enable in config once zone confirmed)
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
