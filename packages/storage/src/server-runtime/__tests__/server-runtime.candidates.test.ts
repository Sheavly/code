import { mkdir, readdir, realpath, symlink } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { useTempFolder } from '../../testing/temp-folder.fake.js';
import { serverNameHash, serverRuntimeCandidates } from '../server-runtime.helper.js';

const temp = useTempFolder('server-candidates-');

describe('serverRuntimeCandidates', () => {
  it('lists the runtime folder of the home first, then the home folder, creating nothing', async () => {
    const xdg = path.join(temp.path(), 'xdg');
    const home = path.join(temp.path(), 'home');

    await mkdir(home);

    const candidates = await serverRuntimeCandidates({
      env: { XDG_RUNTIME_DIR: xdg },
      home,
      platform: 'linux',
    });

    expect(candidates).toEqual([
      { directory: path.join(xdg, 'sheavly', await serverNameHash({ home })), source: 'xdg' },
      { directory: await realpath(home), source: 'home' },
    ]);
    expect(await readdir(temp.path())).toEqual(['home']);
    expect(await readdir(home)).toEqual([]);
  });

  it.each([undefined, '', 'relative/run'])(
    'lists the home folder alone when XDG_RUNTIME_DIR is %j',
    async (xdg) => {
      const home = path.join(temp.path(), 'home');

      await mkdir(home);

      expect(
        await serverRuntimeCandidates({ env: { XDG_RUNTIME_DIR: xdg }, home, platform: 'linux' }),
      ).toEqual([{ directory: await realpath(home), source: 'home' }]);
    },
  );

  it('lists the home folder alone on Windows', async () => {
    const home = path.join(temp.path(), 'home');

    expect(
      await serverRuntimeCandidates({
        env: { XDG_RUNTIME_DIR: temp.path() },
        home,
        platform: 'win32',
      }),
    ).toEqual([{ directory: home, source: 'home' }]);
  });

  it('does not throw for a home that does not exist yet, and creates nothing', async () => {
    const home = path.join(temp.path(), 'not-yet', 'home');
    const candidates = await serverRuntimeCandidates({
      env: { XDG_RUNTIME_DIR: temp.path() },
      home,
      platform: 'linux',
    });

    expect(candidates.map((candidate) => candidate.source)).toEqual(['xdg', 'home']);
    expect(candidates[1]?.directory).toBe(path.resolve(home));
    expect(await readdir(temp.path())).toEqual([]);
  });

  it('names a home reached through a symlink like its real folder', async () => {
    const home = path.join(temp.path(), 'home');
    const link = path.join(temp.path(), 'link');

    await mkdir(home);
    await symlink(home, link);

    const env = { XDG_RUNTIME_DIR: temp.path() };

    expect(await serverRuntimeCandidates({ env, home: link, platform: 'linux' })).toEqual(
      await serverRuntimeCandidates({ env, home, platform: 'linux' }),
    );
  });
});
