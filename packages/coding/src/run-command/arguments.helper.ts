import { PathCheckError, WorkspaceError } from '@sheavly/workspace/errors/workspace.errors';
import type { Workspace } from '@sheavly/workspace/workspace/workspace.service';
import { isMissingPath } from '@sheavly/runtime/errors/errors.utils';
import { isEnvFile } from '../files/files.utils.js';
import { namesEnvFile, pathArguments, stripPathspecMagic } from './arguments.utils.js';
import { gitOutputConcerns } from './git-output.utils.js';
import type { ApprovalConcern } from '@sheavly/protocol/approval/approval.types';

/**
 * What in a command needs the user's approval: a git command that can print or
 * write file contents (`gitOutputConcerns`), and any argument that can name a `.env` file (a
 * glob included) or that the workspace sandbox (`resolveRead`) puts outside the root through
 * `../`, an absolute path or a symlink. Arguments that aren't existing paths (`HEAD~1`) pass.
 * `file` is the command (`git`), `args` the words after it.
 */
export async function findConcerns(params: {
  workspace: Workspace;
  file: string;
  args: readonly string[];
}): Promise<ApprovalConcern[]> {
  const { workspace, file, args } = params;
  const concerns: ApprovalConcern[] = [...gitOutputConcerns({ file, args })];

  for (const argument of pathArguments(args)) {
    if (namesEnvFile(argument)) {
      concerns.push({ argument, reason: 'can name a .env file, which holds secrets' });
      continue;
    }

    const reason = await sandboxConcern({ workspace, path: stripPathspecMagic(argument) });

    if (reason) concerns.push({ argument, reason });
  }

  return concerns;
}

async function sandboxConcern(params: {
  workspace: Workspace;
  path: string;
}): Promise<string | undefined> {
  const { workspace, path } = params;

  try {
    const real = await workspace.resolveRead(path);

    return isEnvFile(real) ? 'is a symlink to a .env file, which holds secrets' : undefined;
  } catch (caughtError) {
    if (caughtError instanceof WorkspaceError) return 'reaches outside the workspace';
    // Not an existing path: a revision, a test name, a file yet to be made.
    if (isMissingPath(caughtError)) return undefined;

    // Unreadable, a symlink loop, ...: the sandbox couldn't check it, so the user decides.
    if (caughtError instanceof PathCheckError) {
      return `could not be checked (${caughtError.code ?? caughtError.message})`;
    }

    throw caughtError;
  }
}
