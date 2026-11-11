import type { WorkingRootStore } from './working-root.types.js';

/**
 * A shell store that lives only as long as the run, for a conversation nothing keeps (a headless
 * run): the working root still works and is shared by the run's agents, but is gone afterwards.
 */
export function memoryShellStore(initial?: unknown): WorkingRootStore {
  let document = initial;

  return {
    load: async () => document,
    update: async (change) => {
      const next = change(document);

      if (next !== undefined) document = next;
    },
  };
}
