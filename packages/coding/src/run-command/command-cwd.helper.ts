import { stat } from 'node:fs/promises';
import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import { isMissingPath } from '@sheavly/runtime/errors/errors.utils';
import { WorkspaceError } from '@sheavly/workspace/errors/workspace.errors';
import type { Workspace } from '@sheavly/workspace/workspace/workspace.service';
import { isInside } from '@sheavly/workspace/workspace/workspace.utils';
import { anchorToRoot } from '@sheavly/workspace/working-root/working-root.utils';
import { assertNotEnvFile, assertNotGitDir } from '../files/files.utils.js';

/**
 * The folder to ask about, when the command runs where the grants do not reach, else undefined.
 * `commandCwd` came from `resolveCommandCwd`, so it is in the root, in scratch or in a verified
 * sibling worktree. The root and the siblings share one mode and allow list, so only scratch is
 * asked about, every time and never kept.
 */
export function outsideGrantedFolder(params: {
  workspace: Workspace;
  commandCwd: string;
}): string | undefined {
  const { workspace, commandCwd } = params;

  if (isInside({ folder: workspace.root, target: commandCwd })) return undefined;

  return workspace.inScratch(commandCwd) ? commandCwd : undefined;
}

/**
 * The real folder a command runs in: the workspace root without `requested`, else `requested`
 * resolved by the workspace (so the root or a sibling git worktree, symlinks followed).
 * Throws a `ToolCallError` the model can act on when it is outside, missing or not a folder.
 */
export async function resolveCommandCwd(params: {
  workspace: Workspace;
  requested: string | undefined;
  root: string | undefined;
}): Promise<string> {
  const { workspace, requested, root } = params;

  if (requested === undefined && root === undefined) return workspace.root;

  // With a working root, "no cwd" means the root, and a relative cwd starts from it. The root
  // goes through the same check as any requested folder, so it can't widen what is reachable.
  const asked = requested ?? '.';

  try {
    return await resolveRequestedCommandCwd({ workspace, requested: asked, root });
  } catch (caughtError) {
    throw cwdError({ requested: asked, caughtError });
  }
}

async function resolveRequestedCommandCwd(params: {
  workspace: Workspace;
  requested: string;
  root: string | undefined;
}): Promise<string> {
  const { workspace, requested, root } = params;
  const anchored = anchorToRoot({ requested, root });

  assertNotEnvFile({ filePath: requested, requested, action: 'Running a command in' });
  assertNotEnvFile({ filePath: anchored, requested, action: 'Running a command in' });
  const real = await workspace.resolveRead(anchored);

  assertNotEnvFile({ filePath: real, requested, action: 'Running a command in' });

  // Git config and hooks there can run programs, so a command doesn't start in .git.
  assertNotGitDir({
    relativePath: workspace.relative(real),
    requested,
    action: 'Running a command',
  });
  if ((await stat(real)).isDirectory()) return real;

  throw new ToolCallError({
    reason: 'invalid_input',
    message: `cwd is not a directory: ${requested}`,
  });
}

function cwdError(params: { requested: string; caughtError: unknown }): unknown {
  const { requested, caughtError } = params;

  if (caughtError instanceof WorkspaceError) {
    return new ToolCallError({ reason: 'forbidden', message: caughtError.message });
  }

  if (isMissingPath(caughtError)) {
    return new ToolCallError({ reason: 'not_found', message: `cwd not found: ${requested}` });
  }

  return caughtError;
}
