import { beforeEach } from 'vitest';
import { FileReads } from '../file-reads/file-reads.service.js';

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
