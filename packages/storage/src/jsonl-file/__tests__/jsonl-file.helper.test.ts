import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { StorageFileError } from '../../errors/storage.errors.js';
import { expectPrivate, useTempFolder } from '../../testing/temp-folder.fake.js';
import { appendJsonLine, readJsonLines, trimPartialLine } from '../jsonl-file.helper.js';

const schema = z.object({ n: z.number(), text: z.string() });
/** Private text no error may quote. */
const SECRET = 'my-private-prompt-4f7a';
const hasFileModes = process.platform !== 'win32';
const temp = useTempFolder('storage-jsonl-');

let file: string;

const lines = async () => {
  const found = [];

  for await (const line of readJsonLines({ file, schema })) found.push(line);

  return found;
};
const failureOf = (run: () => Promise<unknown>) =>
  run().then(
    () => undefined,
    (caughtError: unknown) => caughtError,
  );

beforeEach(() => {
  file = path.join(temp.path(), 'deep', 'log.jsonl');
});

describe('appendJsonLine and readJsonLines', () => {
  it('reads back what was appended, in order, creating the folders; no file is no lines', async () => {
    expect(await lines()).toEqual([]);

    await appendJsonLine({ file, value: { n: 1, text: 'a' } });
    await appendJsonLine({ file, value: { n: 2, text: 'b' } });

    expect(await lines()).toEqual([
      { n: 1, text: 'a' },
      { n: 2, text: 'b' },
    ]);
    expect(await readFile(file, 'utf8')).toBe('{"n":1,"text":"a"}\n{"n":2,"text":"b"}\n');
  });

  it.skipIf(!hasFileModes)('keeps the file and its folders to the user alone', async () => {
    await appendJsonLine({ file, value: { n: 1, text: 'a' } });

    await expectPrivate(file);
  });

  it('reads a long file whole, across the chunks it is read in, with text that spans lines', async () => {
    const text = 'é€𝄞 '.repeat(2000);

    for (let n = 0; n < 40; n += 1) await appendJsonLine({ file, value: { n, text } });

    const read = await lines();

    expect(read).toHaveLength(40);
    expect(read.every((line, index) => line.n === index && line.text === text)).toBe(true);
  });

  it('keeps a newline inside a value as part of it, not as the end of the line', async () => {
    await appendJsonLine({ file, value: { n: 1, text: 'one\ntwo\r\nthree' } });

    expect(await lines()).toEqual([{ n: 1, text: 'one\ntwo\r\nthree' }]);
  });

  it('does not lose a line when many are appended at the same moment', async () => {
    await Promise.all(
      Array.from({ length: 30 }, (_, n) => appendJsonLine({ file, value: { n, text: 'x' } })),
    );

    expect((await lines()).map((line) => line.n).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 30 }, (_, n) => n),
    );
  });
});

describe('a log with a damaged line', () => {
  it('stops at a line that is not JSON, names it, and does not show it', async () => {
    await appendJsonLine({ file, value: { n: 1, text: 'a' } });
    await writeFile(file, `{"n":1,"text":"a"}\n{"n":2,"text":"${SECRET}\n{"n":3,"text":"c"}\n`);

    const seen: number[] = [];
    const failure = await failureOf(async () => {
      for await (const line of readJsonLines({ file, schema })) seen.push(line.n);
    });

    expect(seen).toEqual([1]);
    expect(failure).toBeInstanceOf(StorageFileError);
    expect((failure as Error).message).toContain(file);
    expect((failure as Error).message).toContain('line 2');
    expect(String((failure as Error).stack) + JSON.stringify(failure)).not.toContain(SECRET);
    expect((failure as Error).cause).toBeUndefined();
  });

  it('stops at a line of the wrong shape, naming the line and the field, not the text', async () => {
    await writeFile(file.replace('deep', '.'), `{"n":"one","text":"${SECRET}"}\n`);

    const failure = await failureOf(async () => {
      for await (const _line of readJsonLines({ file: file.replace('deep', '.'), schema }));
    });

    expect(failure).toBeInstanceOf(StorageFileError);
    expect((failure as Error).message).toContain('line 1');
    expect((failure as Error).message).toContain('n');
    expect((failure as Error).message).not.toContain(SECRET);
  });

  it('does not read a last line that has no newline: a write that was cut off', async () => {
    await writeFile(file.replace('deep', '.'), '{"n":1,"text":"a"}\n{"n":2,"text":"b"');

    const read = [];

    for await (const line of readJsonLines({ file: file.replace('deep', '.'), schema })) {
      read.push(line);
    }

    expect(read).toEqual([{ n: 1, text: 'a' }]);
  });
});

describe('a line over the length cap', () => {
  const log = () => file.replace('deep', '.');
  const readAll = async () => {
    for await (const _line of readJsonLines({ file: log(), schema, maxLineChars: 50 }));
  };

  it('is refused before the rest is read, naming the line and not showing it', async () => {
    await writeFile(log(), `{"n":1,"text":"a"}\n${SECRET.repeat(20)}`);

    const failure = await failureOf(readAll);

    expect(failure).toBeInstanceOf(StorageFileError);
    expect((failure as Error).message).toContain('line 2');
    expect((failure as Error).message).toContain('longer than 50');
    expect((failure as Error).message).not.toContain(SECRET);
  });

  it('is refused when its newline does arrive, and a line at the cap is read', async () => {
    await writeFile(log(), `{"n":1,"text":"${'x'.repeat(30)}"}\n`);
    await expect(readAll()).resolves.toBeUndefined();

    await writeFile(log(), `{"n":1,"text":"${'x'.repeat(60)}"}\n`);
    expect(await failureOf(readAll)).toBeInstanceOf(StorageFileError);
  });
});

describe('a line over the cap that spans many chunks', () => {
  const log = () => file.replace('deep', '.');

  it('is refused, with multibyte text, however the chunks cut it', async () => {
    // Over 64KB a chunk, so the file is read in several; the 3-byte euro sign meets chunk edges.
    await writeFile(log(), `{"n":1,"text":"${'€'.repeat(100_000)}"}\n`);

    const failure = await failureOf(async () => {
      for await (const _line of readJsonLines({ file: log(), schema, maxLineChars: 80_000 }));
    });

    expect(failure).toBeInstanceOf(StorageFileError);
    expect((failure as Error).message).toContain('longer than 80000');
  });

  it('is read whole when it fits, however the chunks cut it', async () => {
    const text = '€'.repeat(100_000);

    await writeFile(log(), `{"n":1,"text":"${text}"}\n{"n":2,"text":"b"}\n`);

    const read = [];

    for await (const line of readJsonLines({ file: log(), schema })) read.push(line);

    expect(read).toEqual([
      { n: 1, text },
      { n: 2, text: 'b' },
    ]);
  });
});

describe('trimPartialLine', () => {
  const log = () => file.replace('deep', '.');

  it('finds the last newline when the half-written tail is longer than one block', async () => {
    const tail = 'x'.repeat(200_000);

    await writeFile(log(), `{"n":1,"text":"a"}\n${tail}`);

    expect(await trimPartialLine({ file: log() })).toBe(tail.length);
    expect(await readFile(log(), 'utf8')).toBe('{"n":1,"text":"a"}\n');
  });

  it('cuts a half-written last line, so the next line does not join onto it', async () => {
    await writeFile(log(), '{"n":1,"text":"a"}\n{"n":2,"te');

    expect(await trimPartialLine({ file: log() })).toBe(Buffer.byteLength('{"n":2,"te'));
    await appendJsonLine({ file: log(), value: { n: 2, text: 'b' } });

    expect(await readFile(log(), 'utf8')).toBe('{"n":1,"text":"a"}\n{"n":2,"text":"b"}\n');
  });

  it('leaves a file that ends in a newline, and one that is not there, alone', async () => {
    await writeFile(log(), '{"n":1,"text":"a"}\n');

    expect(await trimPartialLine({ file: log() })).toBe(0);
    expect(await readFile(log(), 'utf8')).toBe('{"n":1,"text":"a"}\n');
    expect(await trimPartialLine({ file: path.join(temp.path(), 'none.jsonl') })).toBe(0);
  });

  it('empties a file that is only a half-written line, and cuts by bytes not letters', async () => {
    await writeFile(log(), '{"text":"é€');

    expect(await trimPartialLine({ file: log() })).toBe(Buffer.byteLength('{"text":"é€'));
    expect(await readFile(log(), 'utf8')).toBe('');
  });
});
