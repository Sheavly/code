import { defineHook } from '@sheavly/core/hook/hook.utils';
import type { Hook } from '@sheavly/core/hook/hook.types';
import type { SessionId } from '@sheavly/protocol/session/session.types';
import { appendInstructionContext } from '../instruction-context/instruction-context.helper.js';
import type { Workspace } from '../workspace/workspace.service.js';
import { renderScratchInstructions } from './scratch.prompt.js';

/**
 * Tells the agent about the shared scratch folder: its own subfolder (created here, on demand)
 * and the shared root. `agentId` is the root agent's id, so sub-agents running the same hook
 * object get their parent's folder. Does nothing when the workspace has no scratch root. The root
 * is shared on purpose, across agents and conversations: anything written there is visible to
 * every agent, so it holds no secrets.
 */
export function createScratchHook(params: { workspace: Workspace; agentId: SessionId }): Hook {
  const { workspace, agentId } = params;

  return defineHook({
    name: 'scratch',
    beforeTurn: async (context) => {
      if (workspace.scratchRoot === undefined) return;

      const folder = await workspace.scratchDir(agentId);
      const instructions = renderScratchInstructions({ folder, root: workspace.scratchRoot });

      appendInstructionContext({ context, name: 'scratch', instructions });
    },
  });
}
