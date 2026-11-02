import { describe, expect, it } from 'vitest';
import { collect } from '@sheavly/core/testing/fake-fetch.fake';
import { readServerSentEvents } from '../sse.utils.js';

const LINE_ENDINGS = { crlf: '\r\n', lf: '\n', cr: '\r' };

/** Three events: a plain one, one with a non-ASCII payload, and one split over two data lines. */
const EVENTS = [{ type: 'a' }, { text: 'blåbær ✓' }, { type: 'multi', n: 1 }];

/** The events as an SSE body, with comments, other fields and a `[DONE]` sentinel mixed in. */
function sseBody(eol: string): Uint8Array {
  const lines = [
    ': keep-alive',
    '',
    'event: message',
    `data: ${JSON.stringify(EVENTS[0])}`,
    '',
    `data: ${JSON.stringify(EVENTS[1])}`,
    '',
    'data: {"type":"multi",',
    'data: "n":1}',
    '',
    'data: [DONE]',
    '',
  ];

  return new TextEncoder().encode(lines.map((line) => line + eol).join(''));
}

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

const read = (chunks: Uint8Array[]) => collect(readServerSentEvents(streamOf(chunks)));

describe('readServerSentEvents', () => {
  describe.each(Object.entries(LINE_ENDINGS))('with %s line endings', (_name, eol) => {
    const body = sseBody(eol);

    it('parses the events from one chunk', async () => {
      expect(await read([body])).toEqual(EVENTS);
    });

    it('parses the events when the stream is split at every possible byte', async () => {
      for (let at = 1; at < body.length; at++) {
        expect(await read([body.subarray(0, at), body.subarray(at)]), `split at ${at}`).toEqual(
          EVENTS,
        );
      }
    });

    it('parses the events from one byte per chunk', async () => {
      const bytes = Array.from(body, (byte) => Uint8Array.of(byte));

      expect(await read(bytes)).toEqual(EVENTS);
    });
  });

  it('parses events whose line endings are mixed', async () => {
    const body = new TextEncoder().encode('data: 1\r\n\ndata: 2\r\rdata: 3\n\r\n');

    expect(await read([body])).toEqual([1, 2, 3]);
  });

  it('parses a last event that ends in a line break but no blank line', async () => {
    const body = new TextEncoder().encode('data: 1\n\ndata: 2\n');

    expect(await read([body])).toEqual([1, 2]);
  });

  it('parses a last event the body ends without a blank line after', async () => {
    const body = new TextEncoder().encode('data: 1\n\ndata: {"type":"response.completed"}');

    expect(await read([body])).toEqual([1, { type: 'response.completed' }]);
  });

  it('names the SSE stream when a data payload is not JSON', async () => {
    const body = new TextEncoder().encode('data: {not json\n\n');

    await expect(read([body])).rejects.toThrow("SSE stream sent a data payload that isn't JSON");
  });

  it('discards a last event the body is cut off in the middle of', async () => {
    const body = new TextEncoder().encode('data: 1\n\ndata: {"type":"response.compl');

    expect(await read([body])).toEqual([1]);
  });
});
