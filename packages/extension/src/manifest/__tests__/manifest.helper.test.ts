import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ExtensionManifestError } from '../../errors/manifest.errors.js';
import { readManifest } from '../manifest.helper.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'extension-manifest-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Writes `content` as `name` under the temp folder and returns its path. */
async function write(params: { name: string; content: string }): Promise<string> {
  const file = path.join(root, params.name);

  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, params.content);

  return file;
}

/** What reading `file` throws; fails the test when it reads. */
function failure(file: string | URL): ExtensionManifestError {
  try {
    readManifest(file);
  } catch (caughtError) {
    expect(caughtError).toBeInstanceOf(ExtensionManifestError);

    return caughtError as ExtensionManifestError;
  }

  throw new TypeError('readManifest did not throw');
}

describe('readManifest', () => {
  it('reads a valid file by path or by URL, with the defaults filled in', async () => {
    const file = await write({
      name: 'sheavly.json',
      content: JSON.stringify({ name: 'notes', dependsOn: ['files'] }),
    });
    const manifest = readManifest(file);

    expect(manifest).toMatchObject({ name: 'notes', dependsOn: ['files'], tools: [] });
    expect(readManifest(pathToFileURL(file))).toEqual(manifest);
  });

  it('names the file and says it cannot be read when it is missing', () => {
    const file = path.join(root, 'sheavly.json');
    const error = failure(file);

    expect(error.file).toBe(file);
    expect(error.message).toContain(file);
    expect(error.message).toContain('cannot be read');
  });

  it('names the file and says it is not valid JSON, for a comment or a trailing comma', async () => {
    const commented = await write({ name: 'a.json', content: '{ // note\n "name": "notes" }' });
    const trailing = await write({ name: 'b.json', content: '{ "name": "notes", }' });

    for (const file of [commented, trailing]) {
      expect(failure(file).message).toContain(file);
      expect(failure(file).message).toContain('is not valid JSON');
    }
  });

  it('names the file and lists every problem when the manifest breaks the schema', async () => {
    const file = await write({
      name: 'sheavly.json',
      content: JSON.stringify({ name: 'Bad Name', toolz: [], dependsOn: 'files' }),
    });
    const { message } = failure(file);

    expect(message).toContain(file);
    expect(message).toContain('name');
    expect(message).toContain('Unrecognized key: "toolz"');
    expect(message).toContain('dependsOn');
  });

  it('reads the grants a manifest asks for', async () => {
    const file = await write({
      name: 'sheavly.json',
      content: JSON.stringify({ name: 'notes', grants: ['task:read', 'output:read'] }),
    });

    expect(readManifest(file).grants).toEqual(['task:read', 'output:read']);
  });

  it('names the file and every bad grant: a wrong format and a repeat', async () => {
    const file = await write({
      name: 'sheavly.json',
      content: JSON.stringify({ name: 'notes', grants: ['Task:Read', 'task:read', 'task:read'] }),
    });
    const { message } = failure(file);

    expect(message).toContain(file);
    expect(message).toContain('grants[0]');
    expect(message).toContain('grants[2]');
    expect(message).toContain('"task:read" is listed twice');
  });

  describe('what it will open', () => {
    it('rejects a directory, saying it is not a regular file', async () => {
      const directory = path.join(root, 'sheavly.json');

      await mkdir(directory);
      expect(failure(directory).message).toContain('is not a regular file');
    });

    it('rejects a FIFO without blocking on it, saying it is not a regular file', async (context) => {
      const fifo = path.join(root, 'pipe.json');

      // No mkfifo here (Windows, a minimal image): the case cannot be built, so it is skipped.
      const made = await promisify(execFile)('mkfifo', [fifo]).then(
        () => true,
        (caughtError: unknown) => {
          if (caughtError instanceof Error) return false;

          throw caughtError;
        },
      );

      if (!made) context.skip();

      expect(failure(fifo).message).toContain('is not a regular file');
    });

    it('rejects a file over 256 KiB with its size, and reads one just under it', async () => {
      const base = JSON.stringify({ name: 'notes' });
      const padding = (size: number) => base + ' '.repeat(size - base.length);
      const big = await write({ name: 'big.json', content: padding(256 * 1024 + 1) });
      const fits = await write({ name: 'fits.json', content: padding(256 * 1024 - 100) });

      expect(failure(big).message).toMatch(
        /is \d+ bytes, more than the 262144 a manifest may have/,
      );
      expect(readManifest(fits).name).toBe('notes');
    });

    it('says a leading byte order mark is the problem, not a generic JSON error', async () => {
      const file = await write({
        name: 'bom.json',
        content: `\uFEFF${JSON.stringify({ name: 'n' })}`,
      });
      const { message } = failure(file);

      expect(message).toContain('byte order mark');
      expect(message).not.toContain('is not valid JSON');
    });
  });

  describe('what an error echoes from the file', () => {
    const ESC = String.fromCharCode(27);

    it('has no control characters from a JSON syntax error snippet', async () => {
      const file = await write({ name: 'a.json', content: `{ "a": ${ESC}[2Jx }` });
      const { message } = failure(file);

      expect(message).toContain('is not valid JSON');
      expect(message).not.toContain(ESC);
    });

    it('has no control characters from a key name, and cuts a very long one', async () => {
      const file = await write({
        name: 'b.json',
        content: JSON.stringify({ name: 'notes', [`bad${ESC}[31m${'k'.repeat(5000)}`]: 1 }),
      });
      const { message } = failure(file);

      expect(message).toContain('Unrecognized key');
      expect(message).not.toContain(ESC);
      expect(message.length).toBeLessThan(3000);
    });

    it('cuts a long JSON syntax reason', async () => {
      const file = await write({ name: 'c.json', content: `{ "a": ${'x'.repeat(5000)} }` });

      expect(failure(file).message.length).toBeLessThan(1000);
    });
  });

  it('rejects a name over 128 characters', async () => {
    const file = await write({
      name: 'long.json',
      content: JSON.stringify({ name: 'n'.repeat(129) }),
    });

    expect(failure(file).message).toContain('name');
  });

  it('is data only: it rejects a file that is not an object', async () => {
    const file = await write({ name: 'sheavly.json', content: '[]' });

    expect(failure(file).message).toContain(file);
  });

  describe('an extension reading its own manifest with new URL("../../sheavly.json", import.meta.url)', () => {
    const helper = "export const manifestUrl = new URL('../../sheavly.json', import.meta.url);\n";

    it.each(['src', 'dist'])(
      'finds the package root from %s/<folder>/<module>.helper.js, the layout before and after a build',
      async (folder) => {
        await write({ name: 'pkg/sheavly.json', content: JSON.stringify({ name: 'notes' }) });
        // The package root's own manifest differs from a decoy a level up, so a wrong depth is seen.
        await write({
          name: 'sheavly.json',
          content: JSON.stringify({ name: 'decoy' }),
        });

        const module = await write({
          name: `pkg/${folder}/notes/notes.helper.mjs`,
          content: helper,
        });
        const { manifestUrl } = (await import(pathToFileURL(module).href)) as { manifestUrl: URL };

        expect(readManifest(manifestUrl).name).toBe('notes');
      },
    );
  });
});
