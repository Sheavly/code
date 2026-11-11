import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Environment } from '@sheavly/core/environment/environment.types';
import { errorCode } from '@sheavly/runtime/errors/errors.utils';
import { PathCheckError, WorkspaceError } from '../errors/workspace.errors.js';
import { GIT_FATAL_EXIT_CODE, GIT_TIMEOUT_MS } from '../workspace/worktrees.constants.js';
import { gitEnv } from '../workspace/worktrees.utils.js';
import { CHECKOUT_GIT_ENV, CHECKOUT_GIT_FLAGS } from './working-root.constants.js';

const execFileAsync = promisify(execFile);

/**
 * Throws a `WorkspaceError` when `dir` is not inside a git work tree, so the agent is told to pick
 * a repo or worktree, and a `PathCheckError` when git itself fails. One git process: the check a
 * tool call makes every time, so a root that stopped being a work tree (its `.git` removed, or
 * replaced by a bare repo) is caught before a search or a command starts in it.
 */
export async function assertWorkTree(params: { dir: string; env: Environment }): Promise<void> {
  const { dir, env } = params;
  // Inside a `.git` folder or a bare repo this prints `false` and still exits 0, so the answer is
  // read, not just the exit code: a root there would let a search start inside `.git`.
  const inside = await runGit({ dir, env, args: ['rev-parse', '--is-inside-work-tree'] });

  if (inside !== 'true') {
    throw new WorkspaceError(`${dir} is not in a git work tree (it is inside .git or a bare repo)`);
  }
}

/**
 * The branch checked out in `dir`, or `undefined` on a detached HEAD. `dir` must already have
 * passed `assertWorkTree`. Throws a `PathCheckError` when git itself fails.
 */
export async function checkedOutBranch(params: {
  dir: string;
  env: Environment;
}): Promise<string | undefined> {
  const branch = await runGit({ ...params, args: ['branch', '--show-current'] });

  return branch === '' ? undefined : branch;
}

async function runGit(params: { dir: string; env: Environment; args: string[] }): Promise<string> {
  const { dir, env, args } = params;

  try {
    // The folder is chosen by the agent and may be a hostile repo, so its config must not be able
    // to make git run a program, whatever command is added here later.
    const { stdout } = await execFileAsync('git', [...CHECKOUT_GIT_FLAGS, '-C', dir, ...args], {
      timeout: GIT_TIMEOUT_MS,
      env: { ...gitEnv(env), ...CHECKOUT_GIT_ENV },
    });

    return stdout.trim();
  } catch (caughtError) {
    // Exit 128 is git's "not a repository"; a missing git program can't hold one either. Any
    // other failure (a timeout, a crash) means the folder could not be checked.
    const fatal = (caughtError as { code?: unknown }).code === GIT_FATAL_EXIT_CODE;

    if (fatal || errorCode(caughtError) === 'ENOENT') {
      throw new WorkspaceError(`${dir} is not in a git repository or worktree`, {
        cause: caughtError,
      });
    }

    throw new PathCheckError({ path: dir, cause: caughtError });
  }
}
