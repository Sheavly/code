import { beforeEach } from 'vitest';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { FileReads } from '../file-reads/file-reads.service.js';

/** Test-only: the id of a named agent (`'main'`, `'child'`), as `FileReads` keys what it was shown. */
export function agentIdFor(name: string) {
  return sessionIdSchema.parse(name);
}

/**
 * Test-only: a fresh `FileReads` for each test, shared by every tool call in it, as
 * `createCodingHarness` shares one. Read `.current` inside a test, never at module load.
 */
export function useFileReads(): { readonly current: FileReads } {
  let reads = new FileReads();

  beforeEach(() => {
    reads = new FileReads();
  });

  return {
    get current() {
      return reads;
    },
  };
}
