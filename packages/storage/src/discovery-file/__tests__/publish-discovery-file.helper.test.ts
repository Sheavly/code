import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chmod, lstat, mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import {
  DISCOVERY_MAX_BYTES,
  DISCOVERY_TOKEN_MAX_CHARS,
  DISCOVERY_URL_MAX_CHARS,
  DISCOVERY_VERSION_MAX_CHARS,
} from '@sheavly/protocol/discovery/discovery.constants';
import { describe, expect, it } from 'vitest';
import { publishDiscoveryFile } from '../publish-discovery-file.helper.js';
import { readDiscoveryFile } from '../read-discovery-file.helper.js';
import {
  deadProcessId,
  plantFile,
  sampleDiscoveryFile,
  tempFileName,
  useDiscoveryFolder,
} from '../testing/discovery-file.fake.js';

const folder = useDiscoveryFolder();
const { uid } = folder;
const posix = it.skipIf(process.platform === 'win32');
const value = sampleDiscoveryFile();

/** Everything a result says, as text: its fields and the message of the error behind it. */
function textOf(result: { status: string; cause?: unknown }): string {
  const cause =
    result.cause instanceof Error ? `${result.cause.message}\n${result.cause.stack}` : '';

  return `${JSON.stringify(result)}\n${cause}`;
}

describe('publishDiscoveryFile', () => {
  it('writes server.json, which the reader then returns whole', async () => {
    const directory = await folder.directory();
    const result = await publishDiscoveryFile({ directory, uid, value });

    expect(result).toEqual({ status: 'published', path: path.join(directory, 'server.json') });
    expect(await readDiscoveryFile({ directory, uid })).toEqual({ status: 'found', value });
    expect(await folder.names(directory)).toEqual(['server.json']);
    expect(JSON.parse(await readFile(path.join(directory, 'server.json'), 'utf8'))).toEqual(value);
  });

  posix('makes the file private to the user', async () => {
    const directory = await folder.directory();

    await publishDiscoveryFile({ directory, uid, value });

    expect((await stat(path.join(directory, 'server.json'))).mode & 0o777).toBe(0o600);
  });

  it('replaces the file of an earlier server whole', async () => {
    const directory = await folder.directory();
    const later = sampleDiscoveryFile({ pid: 9, token: `later-${value.token}` });

    await publishDiscoveryFile({ directory, uid, value });
    await publishDiscoveryFile({ directory, uid, value: later });

    expect(await readDiscoveryFile({ directory, uid })).toEqual({ status: 'found', value: later });
    expect(await folder.names(directory)).toEqual(['server.json']);
  });

  it('refuses a value that is not a discovery file, writing nothing', async () => {
    const directory = await folder.directory();
    const result = await publishDiscoveryFile({
      directory,
      uid,
      value: { ...value, token: 'too-short' },
    });

    expect(result).toEqual({ status: 'refused', reason: 'invalid-value' });
    expect(await folder.names(directory)).toEqual([]);
  });
});

describe('publishDiscoveryFile when the target is not a plain file', () => {
  /** The published file is a regular one that the reader returns, and nothing else is left. */
  async function expectReplaced(directory: string, others: string[] = []): Promise<void> {
    const target = path.join(directory, 'server.json');

    expect((await lstat(target)).isFile()).toBe(true);
    expect(await readDiscoveryFile({ directory, uid })).toEqual({ status: 'found', value });
    expect(await folder.names(directory)).toEqual(['server.json', ...others].sort());
  }

  posix('replaces a link at the final name, and leaves what it points to intact', async () => {
    const directory = await folder.directory();
    const victim = path.join(directory, 'victim');

    await plantFile({ file: victim, text: 'precious' });
    await symlink(victim, path.join(directory, 'server.json'));

    const result = await publishDiscoveryFile({ directory, uid, value });

    expect(result.status).toBe('published');
    expect(await readFile(victim, 'utf8')).toBe('precious');
    expect((await stat(victim)).mode & 0o777).toBe(0o600);
    await expectReplaced(directory, ['victim']);
  });

  posix('replaces a link to a folder, leaving the folder and what is in it', async () => {
    const directory = await folder.directory();
    const victim = path.join(directory, 'victim');

    await mkdir(victim);
    await writeFile(path.join(victim, 'inside'), 'kept');
    await symlink(victim, path.join(directory, 'server.json'));

    expect((await publishDiscoveryFile({ directory, uid, value })).status).toBe('published');
    expect(await readFile(path.join(victim, 'inside'), 'utf8')).toBe('kept');
    await expectReplaced(directory, ['victim']);
  });

  posix('replaces a link that points nowhere, creating nothing at its target', async () => {
    const directory = await folder.directory();

    await symlink(path.join(directory, 'nowhere'), path.join(directory, 'server.json'));

    expect((await publishDiscoveryFile({ directory, uid, value })).status).toBe('published');
    await expectReplaced(directory);
  });

  posix('replaces a FIFO at the final name', async () => {
    const directory = await folder.directory();

    spawnSync('mkfifo', [path.join(directory, 'server.json')]);

    expect((await lstat(path.join(directory, 'server.json'))).isFIFO()).toBe(true);
    expect((await publishDiscoveryFile({ directory, uid, value })).status).toBe('published');
    await expectReplaced(directory);
  });

  posix('replaces a socket at the final name', async () => {
    const directory = await folder.directory();
    const server = createServer();

    await new Promise<void>((resolve) => {
      server.listen(path.join(directory, 'server.json'), resolve);
    });

    try {
      expect((await publishDiscoveryFile({ directory, uid, value })).status).toBe('published');
      await expectReplaced(directory);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  posix('still refuses to read a link at the final name', async () => {
    const directory = await folder.directory();
    const victim = path.join(directory, 'victim');

    await plantFile({ file: victim, text: JSON.stringify(value) });
    await symlink(victim, path.join(directory, 'server.json'));

    expect(await readDiscoveryFile({ directory, uid })).toMatchObject({
      status: 'refused',
      reason: 'link',
    });
  });

  it('refuses a folder at the final name, leaving it as it is', async () => {
    const directory = await folder.directory();
    const target = path.join(directory, 'server.json');

    await mkdir(target);
    await writeFile(path.join(target, 'inside'), 'kept');

    const result = await publishDiscoveryFile({ directory, uid, value });

    expect(result).toEqual({ status: 'refused', reason: 'target-is-folder' });
    expect(await readFile(path.join(target, 'inside'), 'utf8')).toBe('kept');
    expect(await folder.names(directory)).toEqual(['server.json']);
  });
});

describe('publishDiscoveryFile and the size a reader takes', () => {
  it('publishes a value with every field at its schema maximum, which the reader still takes', async () => {
    const directory = await folder.directory();
    const longest = sampleDiscoveryFile({
      url: `http://127.0.0.1/${'~'.repeat(DISCOVERY_URL_MAX_CHARS - 'http://127.0.0.1/'.length)}`,
      token: '~'.repeat(DISCOVERY_TOKEN_MAX_CHARS),
      pid: Number.MAX_SAFE_INTEGER,
      serverVersion: `1.2.3-${'a'.repeat(DISCOVERY_VERSION_MAX_CHARS - 6)}`,
      protocolVersion: `1.2.3-${'a'.repeat(DISCOVERY_VERSION_MAX_CHARS - 6)}`,
    });

    expect((await publishDiscoveryFile({ directory, uid, value: longest })).status).toBe(
      'published',
    );
    expect((await stat(path.join(directory, 'server.json'))).size).toBeLessThanOrEqual(
      DISCOVERY_MAX_BYTES,
    );
    expect(await readDiscoveryFile({ directory, uid })).toEqual({
      status: 'found',
      value: longest,
    });
  });

  it('refuses a token of 5000 characters as an invalid value, writing nothing', async () => {
    const directory = await folder.directory();
    const result = await publishDiscoveryFile({
      directory,
      uid,
      value: { ...value, token: 'a'.repeat(5000) },
    });

    expect(result).toEqual({ status: 'refused', reason: 'invalid-value' });
    expect(await folder.names(directory)).toEqual([]);
  });

  it('refuses text over the cap before anything is written, and keeps the file that is there', async () => {
    const directory = await folder.directory();
    const length = Buffer.byteLength(`${JSON.stringify(value)}\n`);

    await publishDiscoveryFile({ directory, uid, value });

    const later = sampleDiscoveryFile({ pid: 4_242_424 });
    const refused = await publishDiscoveryFile({ directory, uid, value: later, maxBytes: length });
    const exact = await publishDiscoveryFile({ directory, uid, value, maxBytes: length });
    const over = await publishDiscoveryFile({ directory, uid, value, maxBytes: length - 1 });

    expect(refused).toEqual({ status: 'refused', reason: 'too-large' });
    expect(exact.status).toBe('published');
    expect(over).toEqual({ status: 'refused', reason: 'too-large' });
    expect(await folder.names(directory)).toEqual(['server.json']);
    expect(await readDiscoveryFile({ directory, uid })).toEqual({ status: 'found', value });
  });
});

describe('publishDiscoveryFile when the folder is not ours alone', () => {
  posix('refuses a folder open to its group, writing nothing', async () => {
    const directory = await folder.directory();

    await chmod(directory, 0o770);

    const result = await publishDiscoveryFile({ directory, uid, value });

    expect(result).toEqual({ status: 'refused', reason: 'folder', detail: 'too-open' });
    expect(await folder.names(directory)).toEqual([]);
  });

  posix('refuses a folder owned by another user, writing nothing', async () => {
    const directory = await folder.directory();
    const result = await publishDiscoveryFile({ directory, uid: uid + 1, value });

    expect(result).toEqual({ status: 'refused', reason: 'folder', detail: 'other-owner' });
    expect(await folder.names(directory)).toEqual([]);
  });

  posix('refuses a link in place of the folder, and writes nothing through it', async () => {
    const directory = await folder.directory();
    const link = path.join(path.dirname(directory), 'link');

    await symlink(directory, link);

    const result = await publishDiscoveryFile({ directory: link, uid, value });

    expect(result).toEqual({ status: 'refused', reason: 'folder', detail: 'symlink' });
    expect(await folder.names(directory)).toEqual([]);
  });

  it('refuses a folder that is not there', async () => {
    const directory = path.join(await folder.directory(), 'nowhere');
    const result = await publishDiscoveryFile({ directory, uid, value });

    expect(result).toMatchObject({ status: 'refused', reason: 'folder', detail: 'missing' });
  });
});

describe('publishDiscoveryFile and its temp file', () => {
  posix('never follows a link planted at the temp name: it fails, touching nothing', async () => {
    const directory = await folder.directory();
    const victim = path.join(directory, 'victim');
    const temp = path.join(directory, `server.json.${String(process.pid)}.planted.tmp`);

    await plantFile({ file: victim, text: 'precious' });
    await symlink(victim, temp);

    const result = await publishDiscoveryFile({ directory, uid, value, newNonce: () => 'planted' });

    expect(result.status).toBe('failed');
    expect(textOf(result)).not.toContain(value.token);
    expect(await readFile(victim, 'utf8')).toBe('precious');
    expect((await lstat(temp)).isSymbolicLink()).toBe(true);
    expect(await folder.names(directory)).toEqual([path.basename(temp), 'victim']);
  });

  posix(
    'sweeps the temp files of publishes that died, and not those of a live process',
    async () => {
      const directory = await folder.directory();
      const abandoned = tempFileName({ pid: deadProcessId(), fill: '0' });
      const running = tempFileName({ pid: process.pid, fill: '1' });

      await plantFile({ file: path.join(directory, abandoned), text: value.token });
      await plantFile({ file: path.join(directory, running), text: 'in flight' });
      await plantFile({ file: path.join(directory, 'other.tmp'), text: 'not ours' });

      const result = await publishDiscoveryFile({ directory, uid, value });

      expect(result.status).toBe('published');
      expect(await folder.names(directory)).toEqual(['other.tmp', 'server.json', running]);
    },
  );

  posix.each([
    ['0', 'the process group'],
    ['4194305', 'above the highest pid'],
    ['99999999999999999999', 'not a safe integer'],
  ])('sweeps a temp file named for pid %s (%s), which no process can have', async (pid) => {
    const directory = await folder.directory();
    const hostile = tempFileName({ pid, fill: '2' });

    await plantFile({ file: path.join(directory, hostile), text: value.token });

    expect((await publishDiscoveryFile({ directory, uid, value })).status).toBe('published');
    expect(await folder.names(directory)).toEqual(['server.json']);
  });

  posix('removes its temp file when the final step fails, and returns a failure', async () => {
    const directory = await folder.directory();
    const target = path.join(directory, 'server.json');

    // Planted after the target was checked and before the write: the rename then cannot replace it.
    const result = await publishDiscoveryFile({
      directory,
      uid,
      value,
      newNonce: () => {
        mkdirSync(target);

        return 'late';
      },
    });

    expect(result.status).toBe('failed');
    expect(textOf(result)).not.toContain(value.token);
    expect(await folder.names(directory)).toEqual(['server.json']);
  });

  it('puts the token in no result that is not a published file', async () => {
    const directory = await folder.directory();
    const open = path.join(path.dirname(directory), 'open');

    await mkdir(open, { mode: 0o777 });
    await chmod(open, 0o777);

    const results = await Promise.all([
      publishDiscoveryFile({ directory, uid, value: { ...value, url: 'not a url' } }),
      publishDiscoveryFile({ directory: open, uid, value }),
      publishDiscoveryFile({ directory: path.join(directory, 'nowhere'), uid, value }),
    ]);

    for (const result of results) {
      expect(result.status).toBe('refused');
      expect(textOf(result)).not.toContain(value.token);
    }
  });
});
