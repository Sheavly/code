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
