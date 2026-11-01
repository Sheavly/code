/**
 * Minimal Server-Sent Events reader: yields the parsed JSON of each `data:` block.
 * Payloads are returned as `unknown`; callers validate them with zod.
 */
export async function* readServerSentEvents(body: ReadableStream<Uint8Array>): AsyncGenerator {
  let buffer = '';
  const decoder = new TextDecoder();

  for await (const bytes of body) {
    buffer += decoder.decode(bytes, { stream: true }).replaceAll('\r\n', '\n');

    let end: number;

    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, end);

      buffer = buffer.slice(end + 2);

      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');

      if (data && data !== '[DONE]') yield JSON.parse(data);
    }
  }
}
