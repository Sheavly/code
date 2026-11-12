import path from 'node:path';
import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import { anchorToRoot } from '@sheavly/workspace/working-root/working-root.utils';
import type { Workspace } from '@sheavly/workspace/workspace/workspace.service';
import { assertNotEnvFile, assertNotGitDir } from './files.utils.js';

/**
 * Resolves a path the agent may write to: inside the workspace (`resolveWrite` rejects `../`,
 * absolute paths outside and symlinks out), never a .env file and never inside `.git`, before
 * and after symlinks.
 */
export function resolveWritable(params: {
  workspace: Workspace;
  requested: string;
  root: string | undefined;
}): Promise<string> {
  const { workspace, requested, root } = params;

  return resolveGuarded({
    workspace,
    requested,
    action: 'Writing',
    resolve: (asking) => workspace.resolveWrite(anchorToRoot({ requested: asking, root })),
  });
}

/**
 * Resolves an existing file the agent may delete: one regular file inside the workspace (a folder
 * and a symlink are refused by `resolveDelete`), never a .env file and never inside `.git`, before
 * and after symlinks. A path with nothing at it is reported as `not_found`, so the model is told
 * what to do instead of reading an ENOENT.
 */
export function resolveDeletable(params: {
  workspace: Workspace;
  requested: string;
  root: string | undefined;
}): Promise<string> {
  const { workspace, requested, root } = params;

  return resolveGuarded({
    workspace,
    requested,
    action: 'Deleting',
    resolve: (asking) => resolveExisting({ workspace, requested: asking, root }),
  });
}

/**
 * Re-runs the delete resolution under the file's lock, and fails if the path no longer resolves to
 * `expected`. A file swapped for a symlink, or a folder swapped under the path, while the delete
 * waited for its turn would otherwise be read or removed without the guards that picked `expected`
 * (the `.env`/`.git` checks, and `resolveDelete`'s refusal of a symlink or a folder).
 */
export async function assertSameDeletable(params: {
  workspace: Workspace;
  requested: string;
  expected: string;
  root: string | undefined;
}): Promise<void> {
  const { workspace, requested, expected, root } = params;
  const current = await resolveDeletable({ workspace, requested, root });

  if (current !== expected) {
    throw new ToolCallError({
      reason: 'forbidden',
      message: `${requested} changed while the delete waited for its turn. Delete it again.`,
    });
  }
}

/** `resolveDelete`, with a missing path turned into the tool error a caller expects. */
async function resolveExisting(params: {
  workspace: Workspace;
  requested: string;
  root: string | undefined;
}): Promise<string> {
  const { workspace, requested, root } = params;
  const anchored = anchorToRoot({ requested, root });

  try {
    return await workspace.resolveDelete(anchored);
  } catch (caughtError) {
    // ENOENT is the one failure expected here: there is no file at the path to delete.
    if ((caughtError as NodeJS.ErrnoException).code !== 'ENOENT') throw caughtError;

    throw new ToolCallError({ reason: 'not_found', message: `File not found: ${requested}.` });
  }
}

/**
 * A path a file tool changes, whichever change it is: the `.env` and `.git` guards run by name and
 * again after resolving, so a symlink to one is refused too. `action` names what was refused, e.g.
 * "Writing".
 */
async function resolveGuarded(params: {
  workspace: Workspace;
  requested: string;
  action: string;
  resolve: (requested: string) => Promise<string>;
}): Promise<string> {
  const { workspace, requested, action, resolve } = params;

  assertNotEnvFile({ filePath: requested, requested, action });

  // A `.git` in the temp directory's own path is not the workspace's, so only paths relative to
  // the root are checked by name. An absolute path into the workspace is caught after resolving.
  if (!path.isAbsolute(requested)) {
    assertNotGitDir({ relativePath: requested, requested, action });
  }

  const real = await resolve(requested);
  const shown = workspace.relative(real);

  assertNotEnvFile({ filePath: real, requested, action });

  if (!path.isAbsolute(shown)) {
    assertNotGitDir({ relativePath: shown, requested, action });
  }

  return real;
}
