import type { Workspace } from '../workspace/workspace.service.js';
import { memoryShellStore } from '../working-root/memory-shell.helper.js';
import { WorkingRoots } from '../working-root/working-roots.service.js';
import type { WorkingRootStore } from '../working-root/working-root.types.js';

/**
 * Test-only: an in-memory `shell.json`. Two `WorkingRoots` over one store are two agents of one
 * conversation; a store of their own is another conversation.
 */
export const memoryWorkingRootStore = memoryShellStore;

/** Test-only: a conversation's working root over its own in-memory store, with the test's env. */
export function testWorkingRoots(params: {
  workspace: Workspace;
  store?: WorkingRootStore;
}): WorkingRoots {
  const { workspace, store = memoryWorkingRootStore() } = params;

  return new WorkingRoots({ store, workspace, env: process.env });
}
