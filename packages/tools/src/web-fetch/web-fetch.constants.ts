/** Limits apply to the whole call, including redirects, DNS and the response body. */
export const WEB_FETCH_DEFAULTS = {
  timeoutMs: 15_000,
  maxBytes: 1_048_576,
  maxChars: 20_000,
  maxRedirects: 5,
} as const;

export const WEB_FETCH_USER_AGENT = 'Sheavly-WebFetch/1.0';
export const WEB_FETCH_REDIRECTS = [301, 302, 303, 307, 308] as const;
