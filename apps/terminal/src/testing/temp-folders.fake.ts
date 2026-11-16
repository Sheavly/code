import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';

/**
 * Test-only: temporary folders for the tests of the calling file. `make(prefix)` creates one under
 * the system's temp folder; every folder made is removed after each test.
 */
export function useTempFolders() {
  const folders: string[] = [];

  afterEach(async () => {
    await Promise.all(folders.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  return {
    make: async (prefix: string) => {
      const dir = await mkdtemp(path.join(tmpdir(), `${prefix}-`));

      folders.push(dir);

      return dir;
    },
  };
}
