import { execFile } from 'node:child_process';
import { link, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readConfinedFile, realPathOrSelf } from '../confined-read.helper.js';
import { MAX_INSTRUCTION_FILE_BYTES } from '../instruction-source.constants.js';

const run = promisify(execFile);
let base: string;
let boundary: string;

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'confined-read-')));
  boundary = path.join(base, 'project');
  await mkdir(boundary);
  await writeFile(path.join(boundary, 'note.md'), 'inside');
  await writeFile(path.join(base, 'outside.md'), 'outside');
  await writeFile(path.join(boundary, '.env'), 'SECRET=1');
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

const read = (file: string) => readConfinedFile({ file, boundary });

describe('readConfinedFile', () => {
  it('reads a regular file inside the boundary', async () => {
    expect(await read(path.join(boundary, 'note.md'))).toBe('inside');
  });

  it('skips a missing file, a file outside, a .env file and a folder', async () => {
    await mkdir(path.join(boundary, 'folder'), { recursive: true });

    for (const file of ['missing.md', '../outside.md', '.env', 'folder']) {
      expect(await read(path.join(boundary, file))).toBeUndefined();
    }
  });

  it('follows a link that stays inside, and refuses one that leaves or names .env', async () => {
    await symlink(path.join(boundary, 'note.md'), path.join(boundary, 'inner.md'));
    await symlink(path.join(base, 'outside.md'), path.join(boundary, 'leak.md'));
    await symlink(path.join(boundary, '.env'), path.join(boundary, 'env-link.md'));

    expect(await read(path.join(boundary, 'inner.md'))).toBe('inside');
    expect(await read(path.join(boundary, 'leak.md'))).toBeUndefined();
    expect(await read(path.join(boundary, 'env-link.md'))).toBeUndefined();
  });

  it('skips a hard link, which could be a .env or a foreign file under another name', async () => {
    await link(path.join(boundary, '.env'), path.join(boundary, 'hard-env.md'));
    await link(path.join(base, 'outside.md'), path.join(boundary, 'hard-outside.md'));

    expect(await read(path.join(boundary, 'hard-env.md'))).toBeUndefined();
    expect(await read(path.join(boundary, 'hard-outside.md'))).toBeUndefined();
  });

  it('skips a file over the size cap, and reads one at the cap', async () => {
    await writeFile(path.join(boundary, 'huge.md'), 'x'.repeat(MAX_INSTRUCTION_FILE_BYTES + 1));
    await writeFile(path.join(boundary, 'cap.md'), 'x'.repeat(MAX_INSTRUCTION_FILE_BYTES));

    expect(await read(path.join(boundary, 'huge.md'))).toBeUndefined();
    expect((await read(path.join(boundary, 'cap.md')))?.length).toBe(MAX_INSTRUCTION_FILE_BYTES);
  });

  it('refuses every .env spelling, even reached through a folder link or a chain', async () => {
    await writeFile(path.join(boundary, '.ENV'), 'SECRET=2');
    await writeFile(path.join(boundary, '.env.local'), 'SECRET=3');
    await symlink(boundary, path.join(boundary, 'self'));
    await symlink(path.join(boundary, '.env.local'), path.join(boundary, 'hop.md'));
    await symlink(path.join(boundary, 'hop.md'), path.join(boundary, 'chain.md'));

    for (const file of ['.ENV', '.env.local', 'self/.env', 'chain.md']) {
      expect(await read(path.join(boundary, file))).toBeUndefined();
    }
  });

  it('skips a symlink loop', async () => {
    await symlink(path.join(boundary, 'loop-b.md'), path.join(boundary, 'loop-a.md'));
    await symlink(path.join(boundary, 'loop-a.md'), path.join(boundary, 'loop-b.md'));

    expect(await read(path.join(boundary, 'loop-a.md'))).toBeUndefined();
  });

  it('lets an abort stop the read instead of skipping the file', async () => {
    const controller = new AbortController();

    controller.abort();

    await expect(
      readConfinedFile({
        file: path.join(boundary, 'note.md'),
        boundary,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });

  it('skips a named pipe instead of waiting for a writer', async () => {
    const fifo = path.join(boundary, 'pipe.md');

    await run('mkfifo', [fifo]);

    expect(await read(fifo)).toBeUndefined();
  });
});

describe('realPathOrSelf', () => {
  it('resolves a link, and returns a missing path as given', async () => {
    await symlink(boundary, path.join(base, 'alias'));

    expect(await realPathOrSelf(path.join(base, 'alias'))).toBe(boundary);
    expect(await realPathOrSelf(path.join(base, 'nothing'))).toBe(path.join(base, 'nothing'));
  });
});
