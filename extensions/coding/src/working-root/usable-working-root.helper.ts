import type { SourceWorkingRoots } from '@sheavly/core/instruction-context/instruction-source.types';
import { WorkspaceError } from '@sheavly/workspace/errors/workspace.errors';
import type { WorkingRoots } from '@sheavly/workspace/working-root/working-roots.service';

/**
 * The working roots an instruction source reads each turn. A root that went bad (a
 * `WorkspaceError` from `root()`) is `undefined` here: the file tools tell the agent so, and an
 * instruction source falls back to the workspace root. Any other failure is not ours to hide.
 */
export function usableWorkingRoot(workingRoots: Pick<WorkingRoots, 'root'>): SourceWorkingRoots {
  return {
    root: async () => {
      try {
        return await workingRoots.root();
      } catch (caughtError) {
        if (caughtError instanceof WorkspaceError) return undefined;

        throw caughtError;
      }
    },
  };
}
