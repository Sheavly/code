import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashText } from '@sheavly/workspace/file-reads/file-reads.utils';
import { streamLines } from '../read-file.helper.js';
import { selectLines, selectLinesFrom } from '../read-file.utils.js';

const MAX_LINES = 1000;
const MAX_CHARS = 10_000_000; // large, so these cases are about lines, not the character cap
const signal = new AbortController().signal;

let base: string;
let count = 0;

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'read-file-helper-'));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

/** Writes `text` to a new file and streams it. */
async function stream(text: string, startLine?: number) {
  const file = path.join(base, `f${(count += 1)}.txt`);

  await writeFile(file, text);

  return streamLines({ file, startLine, maxLines: MAX_LINES, maxChars: MAX_CHARS, signal });
}

const manyLines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}\n`).join('');

const CASES: { name: string; text: string; startLine?: number; total: number }[] = [
  { name: 'an empty file', text: '', total: 0 },
  { name: 'a file with no trailing newline', text: 'a\nb\nc', total: 3 },
  { name: 'a file with a trailing newline', text: 'a\nb\nc\n', total: 3 },
  { name: 'a startLine in the middle', text: manyLines(50), startLine: 20, total: 50 },
  { name: 'a startLine past the end', text: 'a\nb\n', startLine: 99, total: 2 },
  { name: 'a file bigger than one 64KB chunk', text: manyLines(20_000), total: 20_000 },
  {
    name: 'a file bigger than one chunk with a middle startLine',
    text: manyLines(20_000),
    startLine: 15_000,
    total: 20_000,
  },
  {
    name: 'multibyte characters split across chunk boundaries',
    text: Array.from({ length: 300 }, (_, i) => `${'€'.repeat(1_000)} ${i}\n`).join(''),
    total: 300,
  },
  { name: 'one huge line of multibyte characters', text: '€'.repeat(100_000), total: 1 },
];

describe('streamLines', () => {
  it.each(CASES)('gives selectLines the same window and total for $name', async (item) => {
    const { text, startLine, total } = item;
    const streamed = await stream(text, startLine);
    const lines = text === '' ? [] : text.replace(/\n$/, '').split('\n');
    const first = Math.max(1, startLine ?? 1);

    expect(streamed.total).toBe(total);
    expect(streamed.window).toEqual(lines.slice(first - 1, first - 1 + MAX_LINES));
  });

  it.each(CASES.filter((item) => item.text !== ''))(
    'reports endsWithNewline as selectLines counts it for $name',
    async ({ text, startLine }) => {
      const streamed = await stream(text, startLine);

      expect(streamed.endsWithNewline).toBe(text.endsWith('\n'));
    },
  );

  it.each(CASES)('hashes the whole text of $name, whatever window it keeps', async (item) => {
    const streamed = await stream(item.text, item.startLine);

    expect(streamed.hash).toBe(hashText(item.text));
  });

  it.each(CASES)(
    'selectLinesFrom(streamLines(...)) equals selectLines(text) for $name',
    async ({ text, startLine }) => {
      const streamed = await stream(text, startLine);
      const { hash: _hash, ...rest } = streamed;
      const params = { startLine, maxLines: MAX_LINES, maxChars: MAX_CHARS };

      expect(selectLinesFrom({ ...rest, ...params })).toEqual(selectLines({ text, ...params }));
    },
  );

  it('keeps at most maxLines lines of a long file, and still counts all of them', async () => {
    const streamed = await stream(manyLines(5_000));

    expect(streamed.window).toHaveLength(MAX_LINES);
    expect(streamed.total).toBe(5_000);
  });

  it('keeps no more than maxChars + 1 characters of a line, so one huge line costs a bounded buffer', async () => {
    const file = path.join(base, 'huge.txt');

    await writeFile(file, 'x'.repeat(1_000_000));

    const streamed = await streamLines({
      file,
      startLine: undefined,
      maxLines: 10,
      maxChars: 100,
      signal,
    });

    expect(streamed.window).toEqual(['x'.repeat(101)]);
    expect(streamed.total).toBe(1);
  });

  it('rejects with the abort reason when the signal is aborted', async () => {
    const file = path.join(base, 'aborted.txt');

    await writeFile(file, manyLines(10));

    await expect(
      streamLines({
        file,
        startLine: undefined,
        maxLines: MAX_LINES,
        maxChars: MAX_CHARS,
        signal: AbortSignal.abort(new Error('stopped')),
      }),
    ).rejects.toThrow();
  });
});
