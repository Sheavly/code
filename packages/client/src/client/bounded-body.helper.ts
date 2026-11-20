import { AnswerTooLargeError } from '../errors/client.errors.js';

/**
 * The body of `response` as text, read up to `maxBytes`. A `content-length` over the cap fails
 * before a byte is read, and a body that outgrows it (no length, or a lying one) is cancelled the
 * moment it does, so the sender is not read from any more. Both throw `AnswerTooLargeError`.
 */
export async function readBoundedText(params: {
  response: Response;
  route: string;
  maxBytes: number;
}): Promise<string> {
  const { response, route, maxBytes } = params;
  const tooLarge = new AnswerTooLargeError({ route, maxBytes });
  const declared = Number(response.headers.get('content-length'));

  if (declared > maxBytes) {
    await response.body?.cancel();

    throw tooLarge;
  }

  if (!response.body) return '';

  const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let total = 0;

  for (;;) {
    const chunk = await reader.read();

    if (chunk.done) break;

    total += chunk.value.byteLength;

    if (total > maxBytes) {
      await reader.cancel();

      throw tooLarge;
    }

    text += decoder.decode(chunk.value, { stream: true });
  }

  return text + decoder.decode();
}
