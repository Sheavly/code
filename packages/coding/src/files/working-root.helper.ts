import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import { WorkspaceError } from '@sheavly/workspace/errors/workspace.errors';
import type { WorkingRoots } from '@sheavly/workspace/working-root/working-roots.service';
import { showFromRoot } from '@sheavly/workspace/working-root/working-root.utils';
import type { Workspace } from '@sheavly/workspace/workspace/workspace.service';
import { isInside } from '@sheavly/workspace/workspace/workspace.utils';

/**
 * The folder the agents work from right now, or `undefined` when none is set. A tool reads it
 * once per call and passes it on, so one call never sees two different roots. A root whose folder
 * is gone fails the call with the reason, never falling back to the workspace root: a relative
 * write or delete meant for the worktree must not land in the main checkout.
 */
export async function currentRoot(
  workingRoots: WorkingRoots | undefined,
): Promise<string | undefined> {
  try {
    return await workingRoots?.root();
  } catch (caughtError) {
    if (caughtError instanceof WorkspaceError) {
      throw new ToolCallError({ reason: 'forbidden', message: caughtError.message });
    }

    throw caughtError;
  }
}

/**
 * A path as the agent should see it: relative to the working root when it is inside it, else as
 * the workspace shows it (relative to the workspace root, or absolute in scratch).
 */
export function displayPath(params: {
  workspace: Workspace;
  root: string | undefined;
  absolute: string;
}): string {
  const { workspace, root, absolute } = params;

  if (root !== undefined && isInside({ folder: root, target: absolute })) {
    return showFromRoot({ absolute, root });
  }

  return workspace.relative(absolute);
}
