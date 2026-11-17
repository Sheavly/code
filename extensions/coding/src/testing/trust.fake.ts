import type { MemoryTrust } from './testing.types.js';

/**
 * Test-only: a `TrustPersistence` kept in memory, with the rules a real one has (a change sees the
 * one before it, returning nothing stores nothing, a change that throws stores nothing). `file` is
 * where it pretends to live, which is all the trust store uses it for: refusing a place inside the
 * workspace. It touches no disk. Its queue is not modelled: storage's `DocumentFile` has it, with
 * its own tests.
 */
export function memoryTrust(params: { file: string }): MemoryTrust {
  let document: unknown;
  let failure: Error | undefined;

  return {
    file: params.file,
    set: (next) => {
      document = next;
    },
    get: () => document,
    failWith: (error) => {
      failure = error;
    },
    load: async () => {
      if (failure) throw failure;

      return structuredClone(document);
    },
    update: async (change) => {
      if (failure) throw failure;

      const next = change(structuredClone(document));

      if (next !== undefined) document = structuredClone(next);
    },
  };
}
