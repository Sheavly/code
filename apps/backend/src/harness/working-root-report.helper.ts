import type { ConversationDetails } from '@sheavly/protocol/server/server.types';
import type { WorkingRoots } from '@sheavly/workspace/working-root/working-roots.service';

/**
 * What a UI is told about the working root: its folder and branch while it can be used. A root
 * that is gone is not shown as one: the agent is told by its own turn note, and a header with a
 * dead branch would only mislead. It is a header detail: a git call that fails or times out
 * leaves it out and `onFailure` hears why, instead of failing the model, permissions and usage
 * the same response carries.
 */
export async function reportedWorkingRoot(params: {
  workingRoots: WorkingRoots;
  onFailure?: (caughtError: unknown) => void;
}): Promise<ConversationDetails['workingRoot']> {
  const { workingRoots, onFailure = () => undefined } = params;

  try {
    const state = await workingRoots.state();

    if (state.kind !== 'set') return undefined;

    const { root, branch } = state.info;

    return { root, ...(branch !== undefined && { branch }) };
  } catch (caughtError) {
    // Reported, not hidden: the badge is optional, a broken shell.json or a failing git is not.
    onFailure(caughtError);

    return undefined;
  }
}
