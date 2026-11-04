import { ENTRY_EVENT } from '@sheavly/protocol/api/api.constants';
import { streamEntrySchema } from '@sheavly/protocol/stream/stream.validator';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';

/**
 * The entries of a server's SSE answer (a prompt's response, or `QUERY /stream`), in order, each
 * parsed with the protocol's schema. Heartbeats and other frames are skipped. Ends when the body
 * does; a client that stops early cancels it by breaking out of the loop.
 */
export async function* readEntries(body: ReadableStream<Uint8Array> | null): AsyncGenerator<{
  id: string;
  entry: StreamEntry;
}> {
  if (!body) return;

  const decoder = new TextDecoder();
  let buffered = '';

  for await (const chunk of body) {
    // SSE allows CRLF line endings; one form keeps the frame splitting below simple.
    buffered += decoder.decode(chunk, { stream: true }).replace(/\r\n?/g, '\n');

    for (let end = buffered.indexOf('\n\n'); end !== -1; end = buffered.indexOf('\n\n')) {
      const frame = parseFrame(buffered.slice(0, end));

      buffered = buffered.slice(end + 2);
      if (frame) yield frame;
    }
  }
}

/** One frame's entry, or undefined for a heartbeat comment or another event's frame. */
function parseFrame(frame: string): { id: string; entry: StreamEntry } | undefined {
  const event = /^event: (.*)$/m.exec(frame)?.[1];
  const id = /^id: (.*)$/m.exec(frame)?.[1];
  const data = /^data: (.*)$/m.exec(frame)?.[1];

  if (event !== ENTRY_EVENT || id === undefined || data === undefined) return undefined;

  return { id, entry: streamEntrySchema.parse(JSON.parse(data)) };
}
