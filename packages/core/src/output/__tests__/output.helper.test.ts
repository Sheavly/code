import { describe, expect, it } from 'vitest';
import type { OutputLog } from '@sheavly/protocol/output/output.types';
import { outputRefSchema } from '@sheavly/protocol/output/output.validator';
import { readLog, searchLog } from '../output-range.helper.js';
import type { ByteSource } from '../output.types.js';
import { outputReferenceLines, withLogState } from '../output.utils.js';

const REF = outputRefSchema.parse('3f2b8a52-5c0e-4a0e-9a53-8f7f4b1c2d3e');

const complete = (bytes: number): OutputLog => ({ ref: REF, bytes, status: 'complete' });

/** A log held in memory, read the way a store reads a file: by offset and length. */
function sourceOf(text: string): ByteSource {
  const data = Buffer.from(text, 'utf8');

  return {
    size: () => Promise.resolve(data.length),
    read: ({ offset, length }) => Promise.resolve(data.subarray(offset, offset + length)),
  };
}

describe('readLog', () => {
  it('reads from an offset and says where to continue until the end', async () => {
    const text = 'abcdefghij';
    const first = await readLog({
      log: complete(10),
      source: sourceOf(text),
      offset: 0,
      maxBytes: 4,
    });
    const last = await readLog({
      log: complete(10),
      source: sourceOf(text),
      offset: 8,
      maxBytes: 4,
    });

    expect(first).toMatchObject({ text: 'abcd', offset: 0, nextOffset: 4, totalBytes: 10 });
    expect(last).toMatchObject({ text: 'ij', offset: 8, totalBytes: 10 });
    expect(last).not.toHaveProperty('nextOffset');
  });

  it('never ends or starts inside a multi-byte character', async () => {
    const text = 'aaaa€b'; // the euro sign takes three bytes: 4 to 6
    const source = sourceOf(text);
    const cut = await readLog({ log: complete(8), source, offset: 0, maxBytes: 5 });
    const split = await readLog({ log: complete(8), source, offset: 5, maxBytes: 8 });

    expect(cut.text).toBe('aaaa');
    expect(cut.nextOffset).toBe(4);
    expect(split).toMatchObject({ text: 'b', offset: 7 });
  });

  it.each([-1, 11, 1.5, Number.NaN])(
    'rejects the offset %j outside the stored bytes',
    async (offset) => {
      await expect(
        readLog({ log: complete(10), source: sourceOf('abcdefghij'), offset, maxBytes: 4 }),
      ).rejects.toMatchObject({ reason: 'invalid_range' });
    },
  );

  it('carries the log reference, status and reason with every read', async () => {
    const log: OutputLog = { ref: REF, bytes: 3, status: 'incomplete', reason: 'limit reached' };
    const read = await readLog({ log, source: sourceOf('abc'), offset: 0, maxBytes: 8 });

    expect(read).toMatchObject({ ref: REF, status: 'incomplete', reason: 'limit reached' });
  });
});

describe('searchLog', () => {
  const params = { ref: REF, query: 'needle', fromOffset: 0, maxMatches: 10 };

  it('finds literal, case-sensitive matches with the text around them', async () => {
    const source = sourceOf('a needle b NEEDLE c needle');
    const found = await searchLog({ ...params, log: complete(26), source });

    expect(found.matches.map((match) => match.offset)).toEqual([2, 20]);
    expect(found.matches[0]?.snippet).toBe('a needle b NEEDLE c needle');
  });

  it('stops after maxMatches and says where to continue', async () => {
    const source = sourceOf('needle needle needle');
    const found = await searchLog({ ...params, maxMatches: 1, log: complete(20), source });

    expect(found.matches).toHaveLength(1);
    expect(found.nextOffset).toBe(6);
  });

  it('rejects an empty query and a negative offset', async () => {
    const source = sourceOf('abc');

    await expect(
      searchLog({ ...params, query: '', log: complete(3), source }),
    ).rejects.toMatchObject({
      reason: 'invalid_range',
    });
    await expect(
      searchLog({ ...params, fromOffset: -1, log: complete(3), source }),
    ).rejects.toMatchObject({ reason: 'invalid_range' });
  });
});

describe('withLogState', () => {
  it('adds the reference and status, and the reason only when there is one', () => {
    expect(withLogState({ log: complete(1), body: { text: 'x' } })).toEqual({
      ref: REF,
      text: 'x',
      status: 'complete',
    });
    expect(
      withLogState({ log: { ref: REF, bytes: 1, status: 'incomplete', reason: 'why' }, body: {} }),
    ).toEqual({ ref: REF, status: 'incomplete', reason: 'why' });
  });
});

describe('outputReferenceLines', () => {
  it('says nothing when no output was captured', () => {
    expect(outputReferenceLines({ log: undefined, shown: 'x' })).toEqual([]);
  });

  it('only names the reference when the preview shows everything stored', () => {
    const lines = outputReferenceLines({ log: complete(2), shown: 'ok' });

    expect(lines).toEqual([`Full output: output_ref=${REF} (2 bytes stored, complete)`]);
  });

  it('tells the model how to read the rest when the preview is shorter than the log', () => {
    const lines = outputReferenceLines({ log: complete(100), shown: 'ok' });

    expect(lines.join('\n')).toContain('read_output');
  });

  it('warns that an incomplete log is not everything the command printed', () => {
    const log: OutputLog = { ref: REF, bytes: 2, status: 'incomplete', reason: 'disk full' };
    const text = outputReferenceLines({ log, shown: 'ok' }).join('\n');

    expect(text).toContain('INCOMPLETE: disk full');
    expect(text).toContain('not everything the command printed');
  });
});
