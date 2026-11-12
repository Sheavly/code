import { defineHook } from '@sheavly/core/hook/hook.utils';
import type { Hook } from '@sheavly/core/hook/hook.types';
import { appendInstructionContext } from '@sheavly/workspace/instruction-context/instruction-context.helper';
import type { WorkingRoots } from '@sheavly/workspace/working-root/working-roots.service';
import { WORKING_ROOT_CONTEXT_NAME } from './working-root.constants.js';
import { renderWorkingRootNote } from './working-root.prompt.js';

/**
 * Tells the agent, each turn, where its working root is, so it survives a summary or a restart.
 * It is read fresh from `workingRoots`, so a change by any agent of the conversation shows at
 * once; when the root is cleared the earlier note is replaced by "no instructions apply". A root
 * whose folder is gone is announced as such, so the agent knows before its next tool call fails.
 * Nothing is added while no root was ever set.
 */
export function createWorkingRootHook({ workingRoots }: { workingRoots: WorkingRoots }): Hook {
  return defineHook({
    name: 'working-root',
    beforeTurn: async (context) => {
      appendInstructionContext({
        context,
        name: WORKING_ROOT_CONTEXT_NAME,
        instructions: renderWorkingRootNote(await workingRoots.state()),
      });
    },
  });
}
