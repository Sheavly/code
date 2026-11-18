import { beforeEach } from 'vitest';
import { KeyedLocks } from '../locks/keyed-locks.service.js';

/**
 * Test-only: a fresh `KeyedLocks` for each test, shared by every tool call in it, as
 * the coding extension shares one. Read `.current` inside a test, never at module load.
 */
export function useKeyedLocks(): { readonly current: KeyedLocks } {
  let locks = new KeyedLocks();

  beforeEach(() => {
    locks = new KeyedLocks();
  });

  return {
    get current() {
      return locks;
    },
  };
}
