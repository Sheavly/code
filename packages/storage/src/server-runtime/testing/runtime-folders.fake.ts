import { chmod, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { useTempFolder } from '../../testing/temp-folder.fake.js';
import { serverNameHash, serverRuntimeDirectory } from '../server-runtime.helper.js';

/**
 * Test-only: a temp folder for the runtime folder tests, with folders made at an exact mode (not
 * the umask's), a look at a folder's mode, and `serverRuntimeDirectory` over a given XDG folder.
 */
export function useRuntimeFolders(prefix: string): {
  temp: ReturnType<typeof useTempFolder>;
  uid: number;
  folder: (params: { name: string; mode: number }) => Promise<string>;
  modeOf: (directory: string) => Promise<number>;
  resolveIn: (params: {
    xdg: string;
    home: string;
    uid?: number;
  }) => ReturnType<typeof serverRuntimeDirectory>;
  /** Makes `<xdg>/sheavly/<hash of home>` and sets both folders to `mode`; returns them. */
  plant: (params: { xdg: string; home: string; mode: number }) => Promise<{
    shared: string;
    own: string;
  }>;
} {
  const temp = useTempFolder(prefix);
  const uid = process.getuid?.() ?? 0;

  return {
    temp,
    uid,
    folder: async ({ name, mode }) => {
      const directory = path.join(temp.path(), name);

      await mkdir(directory, { mode });
      await chmod(directory, mode);

      return directory;
    },
    modeOf: async (directory) => (await stat(directory)).mode & 0o777,
    resolveIn: (params) =>
      serverRuntimeDirectory({
        env: { XDG_RUNTIME_DIR: params.xdg },
        home: params.home,
        platform: 'linux',
        uid: params.uid ?? uid,
      }),
    plant: async ({ xdg, home, mode }) => {
      const shared = path.join(xdg, 'sheavly');
      const own = path.join(shared, await serverNameHash({ home }));

      // Both are made open first, so the inner one can be made inside a shared folder that
      // is then set to a mode that cannot be entered.
      await mkdir(own, { recursive: true, mode: 0o700 });
      await chmod(own, mode);
      await chmod(shared, mode);

      return { shared, own };
    },
  };
}
