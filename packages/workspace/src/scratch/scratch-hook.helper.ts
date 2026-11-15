import type { SessionId } from '@sheavly/protocol/session/session.types';
import { INSTRUCTION_ORDER } from '../instruction-context/instruction-source.constants.js';
import type { InstructionSource } from '../instruction-context/instruction-source.types.js';
import type { Workspace } from '../workspace/workspace.service.js';
import { renderScratchInstructions } from './scratch.prompt.js';

/**
 * The scratch instruction source: the agent's own subfolder (created here, on demand) and the
 * shared root. `agentId` is the root agent's id, so sub-agents running the same hook object get
 * their parent's folder. Says nothing when the workspace has no scratch root. The root is shared
 * on purpose, across agents and conversations: anything written there is visible to every agent,
 * so it holds no secrets.
 */
export function scratchSource(params: {
  workspace: Workspace;
  agentId: SessionId;
}): InstructionSource {
  const { workspace, agentId } = params;

  return {
    name: 'scratch',
    order: INSTRUCTION_ORDER.scratch,
    resolve: async () => {
      if (workspace.scratchRoot === undefined) return undefined;

      const folder = await workspace.scratchDir(agentId);

      return renderScratchInstructions({ folder, root: workspace.scratchRoot });
    },
  };
}
