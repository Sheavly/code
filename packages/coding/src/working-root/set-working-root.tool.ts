import { z } from 'zod';
import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { WorkspaceError } from '@sheavly/workspace/errors/workspace.errors';
import type { WorkingRoots } from '@sheavly/workspace/working-root/working-roots.service';
import { assertNotEnvFile } from '../files/files.utils.js';
import { WORKING_ROOT_PROMPTS, renderWorkingRootResult } from './working-root.prompt.js';

/**
 * Lets the agent choose the folder it works from (a git worktree, usually), kept for the whole
 * conversation in `workingRoots`, so the main session and its sub-agents share it. It changes
 * how the agents' paths resolve and are shown, never the user's terminal. A folder that is
 * missing or not in a git repo is refused with the reason, so the agent can pick another.
 */
export function createSetWorkingRootTool({ workingRoots }: { workingRoots: WorkingRoots }) {
  return defineTool({
    name: 'set_working_root',
    description: WORKING_ROOT_PROMPTS.description,
    inputSchema: z.object({
      path: z.string().min(1).optional().describe(WORKING_ROOT_PROMPTS.path),
    }),
    execute: async ({ input: { path: requested } }) => {
      if (requested === undefined) {
        await workingRoots.clear();

        return renderWorkingRootResult(undefined);
      }

      try {
        const info = await workingRoots.set(requested, {
          check: (real) => assertNotEnvFile({ filePath: real, requested, action: 'Working in' }),
        });

        return renderWorkingRootResult(info);
      } catch (caughtError) {
        // A refused folder is the model's to fix; any other failure is not ours to hide.
        if (caughtError instanceof WorkspaceError) {
          throw new ToolCallError({ reason: 'invalid_input', message: caughtError.message });
        }

        throw caughtError;
      }
    },
  });
}
