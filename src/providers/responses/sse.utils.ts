const LINE_BREAK = /\r\n|\r|\n/;

/**
 * Minimal Server-Sent Events reader: yields the parsed JSON of each `data:` block.
 * Lines may end in `\r\n`, `\n` or `\r`, split anywhere across network chunks.
 * Payloads are returned as `unknown`; callers validate them with zod.
 */
export async function* readServerSentEvents(body: ReadableStream<Uint8Array>): AsyncGenerator {
  const readLines = createLineReader();
  let data: string[] = [];

  for await (const bytes of body) {
    for (const line of readLines(bytes)) {
      if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      if (line !== '') continue;

      const payload = data.join('\n');

      data = [];
      if (payload && payload !== '[DONE]') yield JSON.parse(payload);
    }
  }
}

/**
 * Turns chunks into complete lines, keeping the unfinished last line for the next chunk. A chunk
 * ending in `\r` may be the first half of `\r\n`, so a `\n` opening the next chunk is dropped.
 */
function createLineReader() {
  const decoder = new TextDecoder();
  let partial = '';
  let afterCarriageReturn = false;

  return (bytes: Uint8Array): string[] => {
    const decoded = decoder.decode(bytes, { stream: true });

    if (!decoded) return [];

    const text = afterCarriageReturn && decoded.startsWith('\n') ? decoded.slice(1) : decoded;

    afterCarriageReturn = decoded.endsWith('\r');

    const lines = (partial + text).split(LINE_BREAK);

    partial = lines.pop() ?? '';

    return lines;
  };
}
