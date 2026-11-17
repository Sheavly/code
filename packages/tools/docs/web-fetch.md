# Web fetch

`createWebFetchTool` from `@sheavly/tools/web-fetch/web-fetch.tool` needs no workspace. A host
includes it in its tool list, and must explicitly pass it in `createSubAgentTool`'s `tools` for
children to get it (see [sub-agents](sub-agents.md), including `withTaskTools` for tools that
start background tasks). Nothing in a generic harness adds it automatically.

```ts
const web = createWebFetchTool({
  allowedDomains: ['developer.mozilla.org'],
  deniedDomains: ['blocked.developer.mozilla.org'],
  maxChars: 10_000,
});
```

## Input and output

`web_fetch` takes `url` (HTTP or HTTPS, no embedded username or password) and optional
`maxChars` (a positive integer no greater than the host's limit). The result starts with the
final URL after redirects, HTTP status and original Content-Type, followed by an explicit warning
that external content is untrusted data, not instructions. A model may cite it, not obey it.

HTML and XHTML become Markdown. The reader prefers `main`, then `article`, otherwise the page,
and strips scripts, styles, navigation, footers, sidebars, forms and hidden content. Relative
links resolve against the final URL. It never executes JavaScript or loads page resources.
Plain text, Markdown, JSON (including `application/*+json`) and XML retain their text exactly
unless truncated. XML accepts `application/xml`, `text/xml`, `application/rss+xml` and
`application/atom+xml`, including MIME parameters such as `charset=utf-8`. XML is returned as
text, not parsed: external entities, DTDs, stylesheets and embedded links never cause additional
requests or file reads. Missing or other content types, including SVG, images, PDFs, binaries
and unrecognized `+xml` types, are refused. Text is decoded as UTF-8.

## Limits

Factory options and defaults:

| Option         | Default   | Meaning                                                        |
| -------------- | --------- | -------------------------------------------------------------- |
| `timeoutMs`    | 15,000    | Whole call, including DNS, redirects and streaming the body    |
| `maxBytes`     | 1,048,576 | Decoded response bytes consumed before cancelling the download |
| `maxChars`     | 20,000    | Content characters returned, after Markdown conversion         |
| `maxRedirects` | 5         | Redirects followed; zero refuses the first redirect            |

Limits are validated when the tool is created. `timeoutMs` must be between 1 and 2,147,483,647
milliseconds, so Node cannot overflow the timer and silently replace it with a 1 ms timeout.
Reaching the byte cap cancels the body and marks
the result truncated, conservatively including a response ending exactly at the cap. A transport
may already have buffered part of its current chunk; the reader retains only the permitted prefix.
Compressed Content-Length is not trusted as a bound. Partial UTF-8 characters at a byte boundary
are omitted. Character truncation is reported separately. Metadata is outside the content limit.
HTTP failures, unsupported types, malformed redirects, redirect-limit failures, DNS/network failures
and timeouts become error tool results through `runTool`, not failed agent runs.

The run's abort signal stops requests and body reads. It also stops waiting for DNS, though the
operating system's DNS lookup itself is not cancellable. Every call still gets a result through
the normal tool runner, keeping history valid.

## Address and credential rules

Only public addresses may be reached. `localhost` and its subdomains are refused before DNS.
IPv4 private, loopback, link-local, carrier-grade NAT, multicast, unspecified, documentation,
benchmark and other special-use ranges are refused. IPv6 must be global unicast and not a
special-use range; private IPv4 mapped into IPv6 is also refused. Cloud metadata addresses such
as `169.254.169.254` cannot be reached.

Every DNS answer must be public. An empty answer is refused. Each request uses a fresh direct
dispatcher pinned to the first checked address, retaining the hostname for HTTP and TLS. There
is no second DNS lookup, pooled connection from another call or environment proxy. Every redirect,
even on the same hostname, repeats the URL, domain and address checks. A host whose first public
address is unavailable may fail rather than trying another address.

`allowedDomains` restricts the named domains and their subdomains; an empty list denies everything.
`deniedDomains` defaults to empty and takes precedence. Entries are bare domains, not URLs or
wildcards, normalized to lowercase ASCII without a trailing dot. Neither list can override the
public-address rule. Hosts should pass the same domain policy they apply to other network tools;
this tool does not read a workspace's command permissions or sandbox settings.

Requests carry only a fixed `Sheavly-WebFetch/1.0` User-Agent and an Accept header. No cookies,
authentication, user session, Referer or proxy credentials are forwarded or persisted. A URL's
query string is sent as given: do not put secrets in URLs.

For tests or a trusted custom transport, the factory accepts `fetch` and `resolveAddresses`.
The custom fetch must honour the supplied dispatcher, signal, manual redirects and credential
omission, or it can defeat the address policy. Production uses Undici and system DNS.
