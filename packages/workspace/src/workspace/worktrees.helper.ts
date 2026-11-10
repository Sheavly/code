import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { PathCheckError } from '../errors/workspace.errors.js';
import { realPathIfUsable } from './fs-usable.helper.js';
import { isInside } from './workspace.utils.js';
import { belongsToRepo } from './worktree-link.helper.js';
import { GIT_FATAL_EXIT_CODE, GIT_TIMEOUT_MS } from './worktrees.constants.js';
import { gitEnv, owningWorktree, parseWorktreePaths } from './worktrees.utils.js';
import type { Environment } from '@sheavly/core/environment/environment.types';
import { errorCode } from '@sheavly/runtime/errors/errors.utils';

const execFileAsync = promisify(execFile);

/**
 * The other git worktrees of the repo that holds `root`, as real paths, each at the place `root`
 * has in its own worktree (a sub-folder workspace stays a sub-folder). Only worktrees that
 * verifiably belong to the repo count (see `belongsToRepo`): git's own list can be forged by the
 * repo's contents. Empty when `root` isn't in a git repo, git isn't installed or there is no
 * other worktree: the workspace then keeps its single root. Any other failure (a timeout, an
 * unreadable folder) throws a `PathCheckError`.
 */
export async function findSiblingRoots(params: {
  root: string;
  env: Environment;
}): Promise<string[]> {
  const { root, env } = params;
  const listed = await listWorktrees({ root, env });
  // Git lists the main worktree first; its `.git` folder is the repo's common git dir. A
  // submodule or bare repo has no such folder, so nothing verifies and there are no siblings.
  const main = listed[0] === undefined ? undefined : await realPathIfUsable(listed[0]);
  const commonDir =
    main === undefined ? undefined : await realPathIfUsable(path.join(main, '.git'));

  if (main === undefined || commonDir === undefined) return [];
  const worktrees = await verifiedWorktrees({ listed, main, commonDir });
  const own = owningWorktree({ worktrees, root });

  if (!own) return [];
  const subpath = path.relative(own, root);
  const others = worktrees.filter((worktree) => worktree !== own);
  const siblings = await Promise.all(others.map((worktree) => siblingRoot({ worktree, subpath })));

  return siblings.filter((sibling): sibling is string => sibling !== undefined);
}

/**
 * `subpath` in `worktree`, as a real path, or undefined when it is missing or leads out of the
 * worktree: that folder's content comes from a branch, which can commit a symlink there.
 */
async function siblingRoot(params: {
  worktree: string;
  subpath: string;
}): Promise<string | undefined> {
  const { worktree, subpath } = params;
  const real = await realPathIfUsable(path.join(worktree, subpath));

  return real !== undefined && isInside({ folder: worktree, target: real }) ? real : undefined;
}

async function verifiedWorktrees(params: {
  listed: string[];
  main: string;
  commonDir: string;
}): Promise<string[]> {
  const { listed, main, commonDir } = params;
  const real = await Promise.all(listed.map((worktree) => realPathIfUsable(worktree)));
  const existing = real.filter((worktree): worktree is string => worktree !== undefined);
  const verdicts = await Promise.all(
    existing.map((worktree) => belongsToRepo({ worktree, commonDir, isMain: worktree === main })),
  );

  return existing.filter((_worktree, index) => verdicts[index]);
}

async function listWorktrees(params: { root: string; env: Environment }): Promise<string[]> {
  const { root, env } = params;

  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', root, 'worktree', 'list', '--porcelain', '-z'],
      { timeout: GIT_TIMEOUT_MS, env: gitEnv(env) },
    );

    return parseWorktreePaths(stdout);
  } catch (caughtError) {
    // Git missing (ENOENT) or `root` not in a repository (exit 128) just means one root.
    if (errorCode(caughtError) === 'ENOENT' || exitCode(caughtError) === GIT_FATAL_EXIT_CODE) {
      return [];
    }

    throw new PathCheckError({ path: root, cause: caughtError });
  }
}

/** `execFile` puts the process's exit status in `code`, as a number. */
function exitCode(caughtError: unknown): number | undefined {
  const code = (caughtError as { code?: unknown }).code;

  return typeof code === 'number' ? code : undefined;
}
