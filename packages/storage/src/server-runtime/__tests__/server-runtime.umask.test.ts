import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { publishDiscoveryFile } from '../../discovery-file/publish-discovery-file.helper.js';
import { sampleDiscoveryFile } from '../../discovery-file/testing/discovery-file.fake.js';
import { acquireServerLock } from '../../server-lock/server-lock.helper.js';
import { serverRuntimeDirectory } from '../server-runtime.helper.js';
import { useRuntimeFolders } from '../testing/runtime-folders.fake.js';

const { temp, uid, folder, modeOf, resolveIn, plant } = useRuntimeFolders('server-runtime-umask-');
const posix = describe.skipIf(process.platform === 'win32');

// The pool is `forks`, so each test file has its own process and its own umask to change.
posix('the runtime folders under a umask that strips the owner’s bits', () => {
  it.each([
    ['0277', 0o277],
    ['0377', 0o377],
    ['0577', 0o577],
  ])(
    'are made 0700, and the lock and the discovery file work in them (umask %s)',
    async (_n, umask) => {
      const xdg = await folder({ name: 'xdg', mode: 0o700 });
      const home = await folder({ name: 'home', mode: 0o700 });
      const before = process.umask(umask);

      try {
        const resolved = await resolveIn({ xdg, home });

        expect(resolved).toMatchObject({ status: 'ready', source: 'xdg' });

        if (resolved.status !== 'ready') return;

        expect(resolved.warning).toBeUndefined();
        expect(await modeOf(path.join(xdg, 'sheavly'))).toBe(0o700);
        expect(await modeOf(resolved.directory)).toBe(0o700);

        const lock = await acquireServerLock({ home, runtimeDir: resolved.directory });

        expect(lock.status).toBe('acquired');
        expect(
          await publishDiscoveryFile({
            directory: resolved.directory,
            uid,
            value: sampleDiscoveryFile(),
          }),
        ).toMatchObject({ status: 'published' });

        if (lock.status === 'acquired') await lock.release();
      } finally {
        process.umask(before);
      }
    },
  );

  it('makes a home that did not exist 0700, and leaves one that did as it was', async () => {
    const home = path.join(temp.path(), 'new-home');
    const before = process.umask(0o277);

    try {
      expect(await serverRuntimeDirectory({ env: {}, home, platform: 'linux', uid })).toMatchObject(
        { status: 'ready', source: 'home' },
      );
    } finally {
      process.umask(before);
    }

    expect(await modeOf(home)).toBe(0o700);

    const existing = await folder({ name: 'existing', mode: 0o500 });

    expect(
      await serverRuntimeDirectory({ env: {}, home: existing, platform: 'linux', uid }),
    ).toMatchObject({ status: 'ready', directory: await realpath(existing) });
    expect(await modeOf(existing)).toBe(0o500);
  });
});

posix('an existing runtime folder of ours that is not 0700', () => {
  it.each([0o500, 0o300, 0o100, 0o000, 0o750])('is set to 0700 (was %o)', async (mode) => {
    const xdg = await folder({ name: 'xdg', mode: 0o700 });
    const home = await folder({ name: 'home', mode: 0o700 });
    const { shared, own } = await plant({ xdg, home, mode });

    const result = await resolveIn({ xdg, home });

    expect([result.status, await modeOf(shared), await modeOf(own)]).toEqual([
      'ready',
      0o700,
      0o700,
    ]);
    expect(result).toMatchObject({ source: 'xdg', directory: own });
  });
});
