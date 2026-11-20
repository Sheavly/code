import { chmod, mkdir, readdir, realpath, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCK_PATH_MAX_BYTES } from '../../server-lock/server-lock.constants.js';
import { acquireServerLock } from '../../server-lock/server-lock.helper.js';
import {
  checkPrivateDirectory,
  serverNameHash,
  serverRuntimeDirectory,
} from '../server-runtime.helper.js';
import { socketPathBytes } from '../server-runtime.utils.js';
import { useRuntimeFolders } from '../testing/runtime-folders.fake.js';

const { temp, uid, folder, modeOf, resolveIn, plant } = useRuntimeFolders('server-runtime-');
const posix = it.skipIf(process.platform === 'win32');

describe('checkPrivateDirectory', () => {
  posix('accepts our own folder that nobody else can open', async () => {
    const directory = await folder({ name: 'mine', mode: 0o700 });

    expect(await checkPrivateDirectory({ directory, uid })).toEqual({ status: 'private' });
  });

  posix('refuses what is not a private folder of ours, saying why, and never throws', async () => {
    const open = await folder({ name: 'open', mode: 0o750 });
    const file = path.join(temp.path(), 'file');
    const link = path.join(temp.path(), 'link');

    await writeFile(file, '');
    await symlink(await folder({ name: 'target', mode: 0o700 }), link);

    const details = await Promise.all([
      checkPrivateDirectory({ directory: open, uid }),
      checkPrivateDirectory({ directory: file, uid }),
      checkPrivateDirectory({ directory: link, uid }),
      checkPrivateDirectory({ directory: path.join(temp.path(), 'none'), uid }),
      checkPrivateDirectory({ directory: temp.path(), uid: uid + 1 }),
    ]);

    expect(details.map((check) => (check.status === 'refused' ? check.detail : 'private'))).toEqual(
      ['too-open', 'not-directory', 'symlink', 'missing', 'other-owner'],
    );
  });
});

describe('serverNameHash', () => {
  it('names a home through a symlink as the real one, and two homes differently', async () => {
    const real = await folder({ name: 'real', mode: 0o700 });
    const other = await folder({ name: 'other', mode: 0o700 });
    const link = path.join(temp.path(), 'link');

    await symlink(real, link);

    const hash = await serverNameHash({ home: real });

    expect(hash).toMatch(/^[0-9a-f]{12}$/);
    expect(await serverNameHash({ home: link })).toBe(hash);
    expect(await serverNameHash({ home: other })).not.toBe(hash);
  });

  it('hashes the absolute path of a home that does not exist yet', async () => {
    const home = path.join(temp.path(), 'later');
    const before = await serverNameHash({ home });

    await mkdir(home);

    expect(await serverNameHash({ home })).toBe(before);
  });
});

describe('serverRuntimeDirectory', () => {
  posix(
    'uses <xdg>/sheavly/<hash>, both made private, when XDG_RUNTIME_DIR is a private folder of ours',
    async () => {
      const xdg = await folder({ name: 'xdg', mode: 0o700 });
      const home = await folder({ name: 'home', mode: 0o700 });
      const directory = path.join(xdg, 'sheavly', await serverNameHash({ home }));

      expect(await resolveIn({ xdg, home })).toEqual({ status: 'ready', directory, source: 'xdg' });
      expect(await modeOf(path.join(xdg, 'sheavly'))).toBe(0o700);
      expect(await modeOf(directory)).toBe(0o700);
    },
  );

  posix(
    'gives two homes under the same XDG folder two folders, neither touching the other',
    async () => {
      const xdg = await folder({ name: 'xdg', mode: 0o700 });
      const homeA = await folder({ name: 'home-a', mode: 0o700 });
      const homeB = await folder({ name: 'home-b', mode: 0o700 });
      const a = await resolveIn({ xdg, home: homeA });

      if (a.status !== 'ready') throw new Error('home A was not ready');

      await writeFile(path.join(a.directory, 'server.json'), 'A');

      const b = await resolveIn({ xdg, home: homeB });

      if (b.status !== 'ready') throw new Error('home B was not ready');

      expect(b.directory).not.toBe(a.directory);
      expect(await readdir(a.directory)).toEqual(['server.json']);
      expect(await readdir(b.directory)).toEqual([]);
    },
  );

  posix(
    'uses the same folder for a home reached through a symlink as for the real one',
    async () => {
      const xdg = await folder({ name: 'xdg', mode: 0o700 });
      const home = await folder({ name: 'home', mode: 0o700 });
      const link = path.join(temp.path(), 'link');

      await symlink(home, link);

      expect(await resolveIn({ xdg, home: link })).toEqual(await resolveIn({ xdg, home }));
    },
  );

  posix(
    'tightens the sheavly folder and the hash folder it owns that are open to others',
    async () => {
      const xdg = await folder({ name: 'xdg', mode: 0o700 });
      const home = await folder({ name: 'home', mode: 0o700 });
      const { shared, own } = await plant({ xdg, home, mode: 0o755 });

      expect(await resolveIn({ xdg, home })).toMatchObject({ status: 'ready', source: 'xdg' });
      expect(await modeOf(shared)).toBe(0o700);
      expect(await modeOf(own)).toBe(0o700);
    },
  );

  posix('does not use or tighten folders owned by another user, falling back to home', async () => {
    const xdg = await folder({ name: 'xdg', mode: 0o700 });
    const home = await folder({ name: 'home', mode: 0o700 });
    const own = path.join(xdg, 'sheavly', await serverNameHash({ home }));

    await mkdir(own, { recursive: true, mode: 0o700 });
    await chmod(own, 0o755);

    // The injected uid owns nothing here: the XDG folders are refused, and so is the home.
    const result = await resolveIn({ xdg, home, uid: uid + 1 });

    expect(result).toMatchObject({ status: 'unusable', problem: 'dir-not-ours' });
    expect(await modeOf(own)).toBe(0o755);
  });

  posix('refuses a symlink planted at the hash folder and falls back to home', async () => {
    const xdg = await folder({ name: 'xdg', mode: 0o700 });
    const home = await folder({ name: 'home', mode: 0o700 });
    const target = await folder({ name: 'target', mode: 0o700 });

    await mkdir(path.join(xdg, 'sheavly'), { mode: 0o700 });
    await symlink(target, path.join(xdg, 'sheavly', await serverNameHash({ home })));

    const result = await resolveIn({ xdg, home });

    expect(result).toMatchObject({
      status: 'ready',
      source: 'home',
      directory: await realpath(home),
    });
    expect(result.status === 'ready' ? result.warning : undefined).toContain('symlink');
    expect(await readdir(target)).toEqual([]);
  });

  posix('still returns a folder whose socket path is too long: the lock refuses it', async () => {
    const xdg = await folder({ name: `xdg-${'x'.repeat(100)}`, mode: 0o700 });
    const home = await folder({ name: 'home', mode: 0o700 });
    const result = await resolveIn({ xdg, home });

    expect(result).toMatchObject({ status: 'ready', source: 'xdg' });

    if (result.status !== 'ready') throw new Error('not ready');

    expect(socketPathBytes(result.directory)).toBeGreaterThan(LOCK_PATH_MAX_BYTES);
    expect(await acquireServerLock({ home, runtimeDir: result.directory })).toEqual({
      status: 'unusable',
      reason: 'path-too-long',
    });
  });

  posix('uses the home folder, with no warning, when XDG_RUNTIME_DIR is not set', async () => {
    const home = await folder({ name: 'home', mode: 0o700 });
    const result = await serverRuntimeDirectory({ env: {}, home, platform: 'linux', uid });

    expect(result).toEqual({ status: 'ready', directory: await realpath(home), source: 'home' });
  });

  posix('falls back to home with a warning when the XDG folder cannot be used', async () => {
    const home = await folder({ name: 'home', mode: 0o700 });
    const open = await folder({ name: 'open', mode: 0o755 });
    const target = await folder({ name: 'target', mode: 0o700 });
    const link = path.join(temp.path(), 'link');
    const planted = await folder({ name: 'planted', mode: 0o700 });

    await symlink(target, link);
    await symlink(target, path.join(planted, 'sheavly'));

    const results = await Promise.all(
      ['relative/xdg', open, link, planted, path.join(temp.path(), 'missing')].map((xdg) =>
        serverRuntimeDirectory({ env: { XDG_RUNTIME_DIR: xdg }, home, platform: 'linux', uid }),
      ),
    );

    for (const result of results) {
      expect(result).toMatchObject({
        status: 'ready',
        source: 'home',
        directory: await realpath(home),
      });
      expect(result.status === 'ready' ? result.warning : undefined).toContain('XDG_RUNTIME_DIR');
    }

    // A folder that is not ours is reported, never tightened or entered.
    expect(await modeOf(open)).toBe(0o755);
    expect(await modeOf(target)).toBe(0o700);
  });

  posix(
    'makes a missing home private, and uses a home reached through a symlink by its real path',
    async () => {
      const home = path.join(temp.path(), 'new', 'home');
      const link = path.join(temp.path(), 'link');
      const made = await serverRuntimeDirectory({ env: {}, home, platform: 'linux', uid });

      expect(made).toMatchObject({ status: 'ready', source: 'home' });
      expect(await modeOf(home)).toBe(0o700);

      await symlink(home, link);

      expect(await serverRuntimeDirectory({ env: {}, home: link, platform: 'linux', uid })).toEqual(
        {
          status: 'ready',
          directory: await realpath(home),
          source: 'home',
        },
      );
    },
  );

  posix('reports a home that is open to others or not ours, and leaves it as it is', async () => {
    const open = await folder({ name: 'open', mode: 0o755 });
    const mine = await folder({ name: 'mine', mode: 0o700 });
    const tooOpen = await serverRuntimeDirectory({ env: {}, home: open, platform: 'linux', uid });
    const foreign = await serverRuntimeDirectory({
      env: {},
      home: mine,
      platform: 'linux',
      uid: uid + 1,
    });

    expect(tooOpen).toMatchObject({
      status: 'unusable',
      problem: 'dir-not-ours',
      detail: 'too-open',
    });
    expect(foreign).toMatchObject({
      status: 'unusable',
      problem: 'dir-not-ours',
      detail: 'other-owner',
    });
    expect(await modeOf(open)).toBe(0o755);
  });

  posix.each([
    ['a NUL byte', 'bad\0home'],
    ['5000 characters', `/${'h'.repeat(5000)}`],
  ])('resolves, never rejects, for a home with %s', async (_name, home) => {
    const xdg = await folder({ name: `xdg-${String(home.length)}`, mode: 0o700 });
    const results = await Promise.all([
      resolveIn({ xdg, home }),
      serverRuntimeDirectory({ env: {}, home, platform: 'linux', uid }),
    ]);

    for (const result of results) {
      expect(result).toMatchObject({ status: 'unusable', problem: 'dir-unwritable' });
      expect(result.status === 'unusable' ? result.cause : undefined).toBeInstanceOf(Error);
    }

    expect(await readdir(path.join(xdg, 'sheavly'))).toEqual([]);
  });

  it('on Windows returns the home as given and touches no folder', async () => {
    const home = path.join(temp.path(), 'never-made');
    const result = await serverRuntimeDirectory({
      env: { XDG_RUNTIME_DIR: path.join(temp.path(), 'xdg') },
      home,
      platform: 'win32',
      uid: -1,
    });

    expect(result).toEqual({ status: 'ready', directory: home, source: 'home' });
    await expect(stat(home)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
