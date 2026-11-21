import { spawnSync } from 'node:child_process';
import { chmod, mkdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDiscoveryFile } from '../read-discovery-file.helper.js';
import {
  plantFile,
  sampleDiscoveryFile,
  useDiscoveryFolder,
} from '../testing/discovery-file.fake.js';

const folder = useDiscoveryFolder();
const uid = folder.uid;
const posix = it.skipIf(process.platform === 'win32');
const value = sampleDiscoveryFile({ pid: 4242 });
const json = JSON.stringify(value);

async function plantedFolder(params: {
  text: string;
  mode?: number;
  name?: string;
}): Promise<string> {
  const { name, text, mode = 0o600 } = params;
  const directory = await folder.directory(name);

  await plantFile({ file: path.join(directory, 'server.json'), text, mode });

  return directory;
}

describe('readDiscoveryFile', () => {
  it('returns the value of a valid file, and none for a missing file or folder', async () => {
    const directory = await plantedFolder({ text: json });
    const empty = path.join(directory, 'empty');

    await mkdir(empty, { mode: 0o700 });

    expect(await readDiscoveryFile({ directory, uid })).toEqual({ status: 'found', value });
    expect(await readDiscoveryFile({ directory: empty, uid })).toEqual({ status: 'none' });
    expect(await readDiscoveryFile({ directory: path.join(directory, 'nowhere'), uid })).toEqual({
      status: 'none',
    });
  });

  posix('refuses a link at the name, though it points to a valid private file', async () => {
    const directory = await folder.directory();

    await plantFile({ file: path.join(directory, 'real.json'), text: json });
    await symlink(path.join(directory, 'real.json'), path.join(directory, 'server.json'));

    expect(await readDiscoveryFile({ directory, uid })).toEqual({
      status: 'refused',
      reason: 'link',
    });
  });

  posix('refuses a file open to its group or to others', async () => {
    for (const mode of [0o640, 0o644, 0o604]) {
      const directory = await plantedFolder({ text: json, mode, name: `m${mode.toString(8)}` });

      expect(await readDiscoveryFile({ directory, uid })).toEqual({
        status: 'refused',
        reason: 'too-open',
      });
    }
  });

  posix(
    'refuses what is not a regular file, a folder or a named pipe, and does not wait',
    async () => {
      const directory = await folder.directory();
      const pipes = path.join(directory, 'pipes');

      await mkdir(path.join(directory, 'server.json'));
      await mkdir(pipes, { mode: 0o700 });
      spawnSync('mkfifo', [path.join(pipes, 'server.json')]);

      for (const where of [directory, pipes]) {
        expect(await readDiscoveryFile({ directory: where, uid })).toEqual({
          status: 'refused',
          reason: 'not-regular',
        });
      }
    },
  );

  posix('refuses a folder that is not private to us, reading nothing from it', async () => {
    const directory = await plantedFolder({ text: json });
    const link = path.join(path.dirname(directory), 'link');

    await symlink(directory, link);

    expect(await readDiscoveryFile({ directory, uid: uid + 1 })).toEqual({
      status: 'refused',
      reason: 'folder',
      detail: 'other-owner',
    });
    expect(await readDiscoveryFile({ directory: link, uid })).toEqual({
      status: 'refused',
      reason: 'folder',
      detail: 'symlink',
    });

    await chmod(directory, 0o750);

    expect(await readDiscoveryFile({ directory, uid })).toEqual({
      status: 'refused',
      reason: 'folder',
      detail: 'too-open',
    });
  });

  it('refuses a file larger than a discovery file, though it starts as one', async () => {
    const padded = `${json}${' '.repeat(5000)}`;
    const directory = await plantedFolder({ text: padded });

    expect(await readDiscoveryFile({ directory, uid })).toEqual({
      status: 'refused',
      reason: 'too-large',
    });
  });

  it('says a file of a later format was written by a newer Sheavly', async () => {
    const directory = await plantedFolder({
      text: JSON.stringify({ formatVersion: 2, somethingNew: true }),
    });

    expect(await readDiscoveryFile({ directory, uid })).toEqual({
      status: 'newer',
      formatVersion: 2,
    });
  });

  it.each([
    ['not JSON', `{"token": "${value.token}" oops`],
    ['an array', '[]'],
    ['without a field', JSON.stringify({ ...value, url: undefined })],
    ['with a field it does not know', JSON.stringify({ ...value, extra: true })],
    ['of a format before the first', JSON.stringify({ ...value, formatVersion: 0 })],
    ['with a token that is too short', JSON.stringify({ ...value, token: 'short' })],
    ['empty', ''],
  ])('calls a file %s invalid, and shows none of it', async (_name, text) => {
    const directory = await plantedFolder({ text });
    const result = await readDiscoveryFile({ directory, uid });

    expect(result).toEqual({ status: 'invalid' });
  });

  it('puts the token in no result that is not found', async () => {
    const directories = await Promise.all([
      plantedFolder({ text: `${json}${' '.repeat(5000)}`, name: 'large' }),
      plantedFolder({ text: json, mode: 0o644, name: 'open' }),
    ]);
    const results = await Promise.all([
      ...directories.map((directory) => readDiscoveryFile({ directory, uid })),
      readDiscoveryFile({ directory: directories[0] ?? '', uid: uid + 1 }),
    ]);

    for (const result of results) {
      expect(result.status).toBe('refused');
      expect(JSON.stringify(result)).not.toContain(value.token);
    }
  });
});
