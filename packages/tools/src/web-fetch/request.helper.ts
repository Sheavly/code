import { WebFetchError } from '../errors/web-fetch.errors.js';
import { publicDispatcher } from './address.helper.js';
import { withAbort } from './abort.helper.js';
import { readBoundedBody } from './body.helper.js';
import { assertReadableType } from './content.utils.js';
import { WEB_FETCH_REDIRECTS, WEB_FETCH_USER_AGENT } from './web-fetch.constants.js';
import type {
  DownloadedPage,
  WebFetchOptions,
  WebFetchPolicy,
  WebFetchResponse,
} from './web-fetch.types.js';

export async function downloadPage(params: {
  url: URL;
  policy: WebFetchPolicy;
  fetch: NonNullable<WebFetchOptions['fetch']>;
  resolveAddresses: NonNullable<WebFetchOptions['resolveAddresses']>;
  signal: AbortSignal;
}): Promise<DownloadedPage> {
  const { policy, fetch, resolveAddresses, signal } = params;
  let url = params.url;

  for (let redirects = 0; ; redirects++) {
    signal.throwIfAborted();

    const dispatcher = await publicDispatcher({ url, policy, resolveAddresses, signal });

    try {
      const init = {
        signal,
        dispatcher,
        redirect: 'manual' as const,
        credentials: 'omit' as const,
        headers: {
          'user-agent': WEB_FETCH_USER_AGENT,
          accept:
            'text/html, text/plain, text/markdown, application/json, application/xml, text/xml, application/rss+xml, application/atom+xml',
        },
      };
      const response = await withAbort({ operation: fetch(url.href, init), signal });

      if (WEB_FETCH_REDIRECTS.some((status) => status === response.status)) {
        await response.body?.cancel();

        url = redirectedUrl({ response, url, redirects, maxRedirects: policy.maxRedirects });

        continue;
      }

      return await readPage({ response, url, policy, signal });
    } finally {
      // Destroy rather than close: a truncated, failed or cancelled response must not keep a socket.
      await dispatcher.destroy();
    }
  }
}

function redirectedUrl(params: {
  response: WebFetchResponse;
  url: URL;
  redirects: number;
  maxRedirects: number;
}): URL {
  const { response, url, redirects, maxRedirects } = params;

  if (redirects >= maxRedirects) {
    throw new WebFetchError(`Too many redirects (maximum ${maxRedirects}) at ${url.href}`);
  }

  const location = response.headers.get('location');

  if (!location || !URL.canParse(location, url)) {
    throw new WebFetchError(`Invalid or missing redirect location at ${url.href}`);
  }

  return new URL(location, url);
}

async function readPage(params: {
  response: WebFetchResponse;
  url: URL;
  policy: WebFetchPolicy;
  signal: AbortSignal;
}): Promise<DownloadedPage> {
  const { response, url, policy, signal } = params;
  const contentType = response.headers.get('content-type') ?? '';

  try {
    if (!response.ok) {
      throw new WebFetchError(
        `HTTP ${response.status} at ${url.href} (Content-Type: ${contentType || '(missing)'})`,
      );
    }

    assertReadableType(contentType);
  } catch (caughtError) {
    await response.body?.cancel();
    throw caughtError;
  }

  const body = await readBoundedBody({ response, maxBytes: policy.maxBytes, signal });

  return { url, status: response.status, contentType, ...body };
}
