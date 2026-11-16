import { describe, expect, it } from 'vitest';
import { taskEntry as entry } from '../../testing/sse-body.fake.js';
import { readEntries, readFrames } from '../entries.helper.js';

/** A body that sends `chunks` as they are, split wherever a network might split them. */
const body = (chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });

const frame = (seq: number, newline = '\n') =>
  [`event: entry`, `id: ${String(seq)}`, `data: ${JSON.stringify(entry(seq))}`, '', ''].join(
    newline,
  );

async function read(chunks: string[]) {
  const seen: string[] = [];

  for await (const { cursor } of readEntries(body(chunks))) seen.push(cursor);

  return seen;
}

describe('readEntries', () => {
  it('reads every entry frame, whole or split across chunks, CRLF too', async () => {
    const both = frame(0) + frame(1, '\r\n');

    expect(await read([both])).toEqual(['0', '1']);
    expect(await read([both.slice(0, 7), both.slice(7, 40), both.slice(40)])).toEqual(['0', '1']);
  });

  it('skips heartbeats and frames that are not entries', async () => {
    expect(await read([': heartbeat\n\n', 'event: other\ndata: {}\n\n', frame(3)])).toEqual(['3']);
  });

  it('refuses an entry the protocol does not allow', async () => {
    const bad = 'event: entry\nid: 1\ndata: {"seq":1,"kind":"nope"}\n\n';

    await expect(read([bad])).rejects.toThrow();
  });

  it('reads nothing from no body', async () => {
    const seen: unknown[] = [];

    for await (const frameRead of readEntries(null)) seen.push(frameRead);
    expect(seen).toEqual([]);
  });

  it('skips a head frame, an id and nothing else', async () => {
    expect(await read(['id: 41\n\n', frame(42)])).toEqual(['42']);
  });
});

describe('readFrames', () => {
  it('gives a head frame with its cursor and no entry, before the entries', async () => {
    const seen: { cursor: string; entry: boolean }[] = [];

    for await (const { cursor, entry: parsed } of readFrames(
      body([': heartbeat\n\n', 'id: 41\n\n', frame(42)]),
    )) {
      seen.push({ cursor, entry: parsed !== undefined });
    }

    expect(seen).toEqual([
      { cursor: '41', entry: false },
      { cursor: '42', entry: true },
    ]);
  });
});
