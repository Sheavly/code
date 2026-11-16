import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { outputRefSchema } from '@sheavly/protocol/output/output.validator';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import { FileConversationStore } from '../../conversation-store/conversation-store.service.js';
import { expectPrivate, useTempFolder } from '../../testing/temp-folder.fake.js';
import { FileOutputStore } from '../output-store.service.js';

const temp = useTempFolder('file-outputs-');
const make = () => new FileOutputStore({ folder: path.join(temp.path(), 'outputs') });
const limited = (limits: { maxLogBytes: number; maxPendingBytes: number }) =>
  new FileOutputStore({ folder: path.join(temp.path(), 'outputs'), limits });

/** Stores `text`, then reads it back `maxBytes` at a time by following `nextOffset` to the end. */
async function roundTrip(params: { text: string; maxBytes: number }): Promise<string> {
  const store = make();
  const writer = await store.create();

  writer.append(params.text);

  const { ref } = await writer.close();
  let text = '';
  let offset: number | undefined = 0;

  while (offset !== undefined) {
    const range = await store.read({ ref, offset, maxBytes: params.maxBytes });

    text += range.text;
    offset = range.nextOffset;
  }

  return text;
}

describe('a conversation’s outputs', () => {
  const id = conversationIdSchema.parse('00000000-0000-4000-8000-0000000000a1');
  const otherId = conversationIdSchema.parse('00000000-0000-4000-8000-0000000000a2');
  const open = () => new FileConversationStore({ folder: temp.path(), onProblem: () => undefined });

  it('serves a log after the store is reopened, and only to its own conversation', async () => {
    const writer = await open().outputs(id).create();

    writer.append('kept across reopen');

    const { ref } = await writer.close();
    const reopened = open();

    expect((await reopened.outputs(id).read({ ref, offset: 0, maxBytes: 100 })).text).toBe(
      'kept across reopen',
    );
    await expect(reopened.outputs(otherId).log(ref)).rejects.toMatchObject({
      reason: 'not_found',
    });
  });

  it('goes with the conversation when it is deleted', async () => {
    const store = open();
    const writer = await store.outputs(id).create();

    writer.append('gone soon');

    const { ref } = await writer.close();

    await store.delete(id);

    await expect(open().outputs(id).log(ref)).rejects.toMatchObject({ reason: 'not_found' });
  });
});

describe('FileOutputStore', () => {
  it('keeps every chunk whole, in order, privately, and marks the log complete on close', async () => {
    const store = make();
    const writer = await store.create();

    writer.append('first\n');
    writer.append('second\n');

    const closed = await writer.close();

    expect(closed).toMatchObject({ status: 'complete', bytes: 13 });
    expect(await store.log(closed.ref)).toEqual(closed);
    expect(await store.read({ ref: closed.ref, offset: 0, maxBytes: 100 })).toMatchObject({
      text: 'first\nsecond\n',
      status: 'complete',
    });
    await expectPrivate(path.join(temp.path(), 'outputs', `${closed.ref}.log`));
  });

  it('reads a large multiline log in ranges that continue to the last byte', async () => {
    const lines = Array.from({ length: 5000 }, (_, i) => `line ${String(i)}\n`).join('');

    expect(await roundTrip({ text: lines, maxBytes: 4096 })).toBe(lines);
  });

  it('retrieves a single line far larger than any limit, including multibyte characters', async () => {
    const huge = 'é€😀'.repeat(60_000);

    expect(await roundTrip({ text: huge, maxBytes: 1000 })).toBe(huge);
  });

  it('still makes progress when the byte limit is smaller than one character', async () => {
    const text = '€😀é'.repeat(5);

    expect(await roundTrip({ text, maxBytes: 1 })).toBe(text);
  });

  it('closes once however often it is asked, and ignores chunks after the close began', async () => {
    const store = make();
    const writer = await store.create();

    writer.append('kept');

    const first = writer.close();

    writer.append('too late');

    const [a, b] = await Promise.all([first, writer.close()]);

    expect(b).toEqual(a);
    expect(a).toMatchObject({ status: 'complete', bytes: 4 });
    expect((await store.read({ ref: a.ref, offset: 0, maxBytes: 100 })).text).toBe('kept');
  });

  it('reports a log that is finishing as capturing or complete, never as lacking its record', async () => {
    const store = make();
    const writer = await store.create();

    writer.append('x');

    const closing = writer.close();
    const seen = await store.log(writer.log.ref);

    await closing;

    expect(seen.status).toBe('capturing');
  });

  it('searches from an offset and continues until the end', async () => {
    const store = make();
    const writer = await store.create();

    writer.append(`${'a\n'.repeat(100)}needle one\n${'b\n'.repeat(100)}needle two\n`);

    const { ref } = await writer.close();
    const first = await store.search({ ref, query: 'needle', fromOffset: 0, maxMatches: 1 });

    expect(first.matches).toHaveLength(1);
    expect(first.matches[0]?.snippet).toContain('needle one');
    expect(first.nextOffset).toBeDefined();

    const second = await store.search({
      ref,
      query: 'needle',
      fromOffset: first.nextOffset ?? 0,
      maxMatches: 5,
    });

    expect(second.matches.map((m) => m.snippet.includes('needle two'))).toEqual([true]);
    expect(second.nextOffset).toBeUndefined();
  });

  it('reads output captured so far while the capture is still running', async () => {
    const store = make();
    const writer = await store.create();

    writer.append('so far');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(await store.log(writer.log.ref)).toMatchObject({ status: 'capturing' });
    expect((await store.read({ ref: writer.log.ref, offset: 0, maxBytes: 100 })).text).toBe(
      'so far',
    );
    await writer.close();
  });

  it('reports a log whose process died mid-capture as incomplete, never complete', async () => {
    const store = make();
    const ref = outputRefSchema.parse('11111111-1111-4111-8111-111111111111');

    await store.create().then((w) => w.close());
    await writeFile(path.join(temp.path(), 'outputs', `${ref}.log`), 'partial');

    expect(await make().log(ref)).toMatchObject({ status: 'incomplete', bytes: 7 });
  });

  it.each([
    { status: 'incomplete' },
    { status: 'complete', reason: 'a reason a complete log cannot have' },
    { status: 'capturing' },
  ])('treats a stored record that is not a final one (%j) as no record', async (record) => {
    const store = make();
    const { ref } = await (await store.create()).close();

    await writeFile(path.join(temp.path(), 'outputs', `${ref}.json`), JSON.stringify(record));

    expect(await make().log(ref)).toMatchObject({
      status: 'incomplete',
      reason: expect.stringContaining('without a final record') as string,
    });
  });

  it('answers not_found for a reference this conversation does not have', async () => {
    const store = make();
    const ref = outputRefSchema.parse('22222222-2222-4222-8222-222222222222');

    await expect(store.read({ ref, offset: 0, maxBytes: 10 })).rejects.toMatchObject({
      reason: 'not_found',
    });
    await expect(store.log(ref)).rejects.toMatchObject({ reason: 'not_found' });
  });

  it('does not reach another conversation’s log with the same reference', async () => {
    const mine = make();
    const other = new FileOutputStore({ folder: path.join(temp.path(), 'other', 'outputs') });
    const { ref } = await (await mine.create()).close();

    await expect(other.log(ref)).rejects.toMatchObject({ reason: 'not_found' });
  });

  it('rejects an offset past the end and an empty query', async () => {
    const store = make();
    const writer = await store.create();

    writer.append('abc');

    const { ref } = await writer.close();

    await expect(store.read({ ref, offset: 99, maxBytes: 10 })).rejects.toMatchObject({
      reason: 'invalid_range',
    });
    await expect(
      store.search({ ref, query: '', fromOffset: 0, maxMatches: 1 }),
    ).rejects.toMatchObject({ reason: 'invalid_range' });
  });

  it('reports unavailable when a capture cannot start', async () => {
    const blocked = new FileOutputStore({ folder: path.join(temp.path(), 'file', 'outputs') });

    await writeFile(path.join(temp.path(), 'file'), 'not a folder');
    await expect(blocked.create()).rejects.toMatchObject({ reason: 'unavailable' });
  });

  it('marks the log incomplete, with the reason, once it passes its size limit', async () => {
    const store = limited({ maxLogBytes: 10, maxPendingBytes: 1000 });
    const writer = await store.create();

    writer.append('12345678');
    writer.append('abcdef');
    writer.append('more');

    const closed = await writer.close();

    expect(closed).toMatchObject({ status: 'incomplete', bytes: 8 });
    expect(closed.reason).toContain('10-byte limit');
    expect((await store.read({ ref: closed.ref, offset: 0, maxBytes: 100 })).text).toBe('12345678');
  });

  it('bounds what waits for the disk: past it the log is incomplete, not unbounded', async () => {
    const store = limited({ maxLogBytes: 1000, maxPendingBytes: 4 });
    const writer = await store.create();

    writer.append('abc');
    writer.append('defgh');

    const closed = await writer.close();

    expect(closed.status).toBe('incomplete');
    expect(closed.reason).toContain('keep up');
  });
});
