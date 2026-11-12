# Web search

`web_search` turns a query into a bounded list of `{ title, url, snippet }` results. It is opt-in:
`createWebSearchTool` requires a `backend`, and never reads settings, environment variables or
credentials. The app decides whether a run includes search and which provider serves it. Search
and `web_fetch` are complementary: search discovers URLs; fetch reads a selected page in detail.

## Select a backend in the app

```ts
import { createWebSearchTool } from '@sheavly/tools/web-search/web-search.tool';
import { createTavilySearchBackend } from '@sheavly/tools/web-search-backends/tavily-search.helper';

const search = createWebSearchTool({
  backend: createTavilySearchBackend(), // Explicit Tavily selection, documented keyless access.
  maxResults: 5,
  maxSnippetChars: 1_000,
  timeoutMs: 15_000,
});
```

Tavily sends `POST https://api.tavily.com/search` with JSON and
`X-Tavily-Access-Mode: keyless`, as documented in
[Tavily's official keyless guide](https://docs.tavily.com/documentation/keyless.md).
Keyless access uses the usual search response schema and can be rate-limited. It requires no
OpenCode or other client-identity impersonation headers. If an app explicitly supplies
`createTavilySearchBackend({ apiKey })`, the factory sends `Authorization: Bearer …` instead of
the keyless header. No key is discovered from env, profiles or a model backend. Redirects are
refused so credentials cannot be forwarded to another endpoint.

Concrete transports live in `web-search-backends/`, marked by this package's
`sheavly.appOnlyModules` metadata. `harness/imports` rejects value imports of that module from
package source, including the search tool itself; apps select and inject the backend. Tests,
fakes, type-only imports and imports within the same marked module are allowed. The generic
`web-search/` contract remains available to packages without selecting a concrete transport.

Another provider implements `SearchBackend` from `web-search/web-search.types`: a safe short
`name` (letters, digits, underscore or hyphen) and
`search({ query, maxResults, signal }): Promise<SearchResult[]>`. Its results contain only title,
public HTTP(S) URL without embedded credentials, and snippet. Honour `signal`, avoid automatic
credential discovery, and do not put transport metadata, raw response bodies or credentials into
results. The tool validates even custom backend output and enforces output limits independently.

## Keyless backends and fallback

Besides Tavily, `web-search-backends/` has keyless backends for TinyFish, Exa, Parallel and
Firecrawl (`keyless-search.helper`) and Wikipedia (`wikipedia-search.helper`). The four providers
are called with one plain JSON-RPC `tools/call` POST (no MCP session or handshake), and the reply
may be JSON or server-sent events. Each takes an optional `apiKey`, supplied only by the app:

| Backend   | Endpoint                     | Tool               | Keyless access                    |
| --------- | ---------------------------- | ------------------ | --------------------------------- |
| TinyFish  | `agent.tinyfish.ai/mcp`      | `search`           | `X-TinyFish-Access-Mode: keyless` |
| Exa       | `mcp.exa.ai/mcp`             | `web_search_exa`   | no header                         |
| Parallel  | `search.parallel.ai/mcp`     | `web_search`       | no header                         |
| Firecrawl | `mcp.firecrawl.dev/v2/mcp`   | `firecrawl_search` | no header; replies are large      |
| Wikipedia | `en.wikipedia.org/w/api.php` | n/a                | key-free, covers only Wikipedia   |

Keyless limits for Exa, Parallel and Firecrawl are undocumented and can change.

`createFallbackSearchBackend({ backends })` tries them in order and moves on after a failure,
timeout or rate limit (`WebSearchRateLimitError`). Each backend gets its own timeout
(`backendTimeoutMs`, 8s) inside the call's overall timeout. A rate-limited backend is skipped for its
`Retry-After` seconds, or `defaultCooldownMs` (60s); when all are cooling down the call fails at
once. A caller abort stops the chain. The error names the failed backends, nothing else. The
cooldowns live in the chain instance, so share one. The backend app orders it with
`WEB_SEARCH_BACKENDS` (default `tavily,tinyfish,exa,parallel,wikipedia`).

To check the real endpoints, run `LIVE_SEARCH=true npx vitest run live-search` in this package.
It is off by default, so CI never uses the network; a rate-limited endpoint counts as reachable.

## Results and limits

Model input is only `query`: trimmed, nonempty and at most 2,000 characters. Model calls cannot
raise the host limits. Defaults are five results, 1,000 snippet characters, and a 15-second
whole-call timeout. Hosts can request at most 20 results. Titles are capped at 300 characters;
URLs at 4,096. Oversized snippets and titles are clipped, and excess results are dropped.
An empty list is a successful search with no matches.

The model receives JSON `{ query, results }`, not a provider's raw JSON. The tool also returns
the same bounded data in a `WebSearchArtifact` tagged `kind: 'web_search'`. UIs can narrow a
`ToolArtifact` with `isWebSearchArtifact` from `web-search/web-search.utils`; the guard validates
the payload as well as the tag. Artifacts remain tool-result UI data, not a new protocol event.
Search results are untrusted external data, not instructions or proof that a page's claims are true.

The Tavily transport accepts `maxBytes` (default and ceiling: 1,048,576 decoded response bytes).
It reads a bounded stream and rejects oversized JSON rather than parsing a truncated document;
it does not trust compressed or missing Content-Length. The JSON content type and result schema
are validated. Only result title, URL and content (mapped to snippet) are retained; answers,
scores and other provider fields are discarded. The request disables generated answers and raw
page content. An injected `fetch` must be native-fetch compatible and honour its signal.

## Failures and tests

Errors identify the selected backend. Tavily distinguishes access denial, rate limiting, quota
exhaustion and other HTTP statuses. Non-JSON responses, malformed results, transport failures,
timeouts and cancellation fail the tool without returning an artifact or partial response. HTTP
bodies, response headers, exception messages, validation values and abort reasons are never put
into model-facing failures; original exceptions are retained only as diagnostic error causes.

The timeout covers fetching and reading the response. Caller aborts propagate to the backend;
the tool also stops waiting when an injected dependency ignores cancellation. The underlying
operation can only be stopped if that dependency honours its signal.

Tests use `fakeFetch` from `@sheavly/tools/testing/web-search.fake` with queued `Response` objects
and recorded requests. Exhausted queues throw; they never fall back to the network. The tool's
neutral contract, output validation, access headers, limits, aborts and failure redaction are
covered without live searches or paid model calls.
