import type * as FsPromises from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { useRuntimeFolders } from '../testing/runtime-folders.fake.js';

const owner = vi.hoisted(() => ({ foreignName: '', uid: 0 }));

// The test user owns every folder it can make, so another owner is faked for one name only.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();

  return {
    ...actual,
    lstat: async (target: string) => {
      const real = await actual.lstat(target);

      return path.basename(target) === owner.foreignName
        ? (Object.assign(Object.create(Object.getPrototypeOf(real) as object), real, {
            uid: owner.uid,
          }) as typeof real)
        : real;
    },
  };
});

const { uid, folder, modeOf, resolveIn } = useRuntimeFolders('server-runtime-foreign-');
const posix = describe.skipIf(process.platform === 'win32');

posix('a runtime folder that another user owns', () => {
  it('is not changed, even with a missing owner bit, and the result falls back as before', async () => {
    const xdg = await folder({ name: 'xdg', mode: 0o700 });
    const home = await folder({ name: 'home', mode: 0o700 });
    const shared = await folder({ name: 'xdg/sheavly', mode: 0o500 });

    owner.foreignName = 'sheavly';
    owner.uid = uid + 1;

    const result = await resolveIn({ xdg, home });

    expect(result).toMatchObject({ status: 'ready', source: 'home' });
    expect(result.status === 'ready' ? result.warning : undefined).toContain('other-owner');
    expect(await modeOf(shared)).toBe(0o500);
  });
});
