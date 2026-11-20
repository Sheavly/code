import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { afterEach } from 'vitest';
import { useTempFolder } from '../../testing/temp-folder.fake.js';
import { ServerPresence } from '../server-presence.service.js';

/**
 * Test-only: `ServerPresence` objects on a home in the test's own temp folder, each with the
 * warnings it logged. Every one is removed and released when the test ends, so no socket or file
 * outlives it.
 */
export function usePresences(): {
  home: () => string;
  uid: number;
  make: (options?: { home?: string; env?: Record<string, string | undefined> }) => {
    presence: ServerPresence;
    logs: string[];
  };
} {
  const temp = useTempFolder('server-presence-');
  const made: ServerPresence[] = [];
  const uid = process.getuid?.() ?? 0;

  afterEach(async () => {
    for (const presence of made.splice(0)) {
      await presence.remove();
      await presence.release();
    }
  });

  return {
    home: () => path.join(temp.path(), 'home'),
    uid,
    make: (options = {}) => {
      const logs: string[] = [];
      const presence = new ServerPresence({
        home: options.home ?? path.join(temp.path(), 'home'),
        env: options.env ?? {},
        uid,
        log: (message) => {
          logs.push(message);
        },
      });

      made.push(presence);

      return { presence, logs };
    },
  };
}

/** Test-only: a folder `depth` levels below `root`, deep enough to pass a socket path's limit. */
export async function deepFolder(params: { root: string; name: string; depth: number }) {
  const folder = path.join(params.root, ...Array.from({ length: params.depth }, () => params.name));

  await mkdir(folder, { recursive: true, mode: 0o700 });

  return folder;
}
