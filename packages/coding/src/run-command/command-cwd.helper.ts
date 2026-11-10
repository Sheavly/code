import { stat } from 'node:fs/promises';
import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import { isMissingPath } from '@sheavly/runtime/errors/errors.utils';
import { WorkspaceError } from '@sheavly/workspace/errors/workspace.errors';
import type { Workspace } from '@sheavly/workspace/workspace/workspace.service';
import { assertNotEnvFile, assertNotGitDir } from '../files/files.utils.js';

/**
 * The real folder a command runs in: the workspace root without `requested`, else `requested`
 * resolved by the workspace (so the root or a sibling git worktree, symlinks followed).
 * Throws a `ToolCallError` the model can act on when it is outside, missing or not a folder.
 */
export async function resolveCommandCwd(params: {
  workspace: Workspace;
  requested: string | undefined;
}): Promise<string> {
  const { workspace, requested } = params;

  if (requested === undefined) return workspace.root;

  try {
    assertNotEnvFile({ filePath: requested, requested, action: 'Running a command in' });
    const real = await workspace.resolveRead(requested);

    assertNotEnvFile({ filePath: real, requested, action: 'Running a command in' });

    // Git config and hooks there can run programs, so a command doesn't start in .git.
    assertNotGitDir({
      relativePath: workspace.relative(real),
      requested,
      action: 'Running a command',
    });
    if ((await stat(real)).isDirectory()) return real;
  } catch (caughtError) {
    throw cwdError({ requested, caughtError });
  }

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
