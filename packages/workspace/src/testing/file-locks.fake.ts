import { beforeEach } from 'vitest';
import { FileLocks } from '../file-locks/file-locks.service.js';

/**
 * Test-only: a fresh `FileLocks` for each test, shared by every tool call in it, as
 * `createCodingHarness` shares one. Read `.current` inside a test, never at module load.
 */
export function useFileLocks(): { readonly current: FileLocks } {
  let locks = new FileLocks();

  beforeEach(() => {
    locks = new FileLocks();
  });

  return {
    get current() {
      return locks;
    },
  };
}
