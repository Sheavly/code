import { INSTRUCTION_ORDER } from '@sheavly/workspace/instruction-context/instruction-source.constants';
import type { InstructionSource } from '@sheavly/workspace/instruction-context/instruction-source.types';
import type { WorkingRoots } from '@sheavly/workspace/working-root/working-roots.service';
import { WORKING_ROOT_CONTEXT_NAME } from './working-root.constants.js';
import { renderWorkingRootNote } from './working-root.prompt.js';

/**
 * The working-root instruction source: each turn, where the agent's working root is, so it
 * survives a summary or a restart. It is read fresh from `workingRoots`, so a change by any agent
 * of the conversation shows at once; when the root is cleared the earlier note is replaced by "no
 * instructions apply". A root whose folder is gone is announced as such, so the agent knows
 * before its next tool call fails. Nothing is added while no root was ever set.
 */
export function workingRootSource({
  workingRoots,
}: {
  workingRoots: WorkingRoots;
}): InstructionSource {
  return {
    name: WORKING_ROOT_CONTEXT_NAME,
    order: INSTRUCTION_ORDER.workingRoot,
    resolve: async () => renderWorkingRootNote(await workingRoots.state()),
  };
}
