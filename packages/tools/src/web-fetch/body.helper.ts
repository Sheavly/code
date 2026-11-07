import { withAbort } from './abort.helper.js';
import type { WebFetchResponse } from './web-fetch.types.js';

/** Counts decoded response bytes, not compressed Content-Length. Cancels at the byte cap. */
export async function readBoundedBody(params: {
  response: WebFetchResponse;
  maxBytes: number;
  signal: AbortSignal;
}): Promise<{ text: string; truncated: boolean }> {
  const { response, maxBytes, signal } = params;

  if (!response.body) return { text: '', truncated: false };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;

  try {
    while (true) {
      signal.throwIfAborted();

      const chunk = await withAbort({ operation: reader.read(), signal });

      if (chunk.done) return { text: text + decoder.decode(), truncated: false };

      const remaining = maxBytes - bytes;

      text += decoder.decode(chunk.value.subarray(0, remaining), { stream: true });
      bytes += chunk.value.byteLength;

      // Do not flush a partial UTF-8 character at the boundary.
      if (bytes >= maxBytes) return { text, truncated: true };
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
