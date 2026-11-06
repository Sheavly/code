import { readFile, writeFile } from 'node:fs/promises';
import type { ToolContext } from '@sheavly/core/tool/tool.types';
import type { Workspace } from '@sheavly/workspace/workspace/workspace.service';
import { assertNotEnvFile, assertNotGitDir } from './files.utils.js';

/**
 * Resolves a path the agent may write to: inside the workspace (`resolveWrite` rejects `../`,
 * absolute paths outside and symlinks out), never a .env file and never inside `.git`, before
 * and after symlinks.
 */
export async function resolveWritable(params: {
  workspace: Workspace;
  requested: string;
}): Promise<string> {
  const { workspace, requested } = params;

  assertNotEnvFile({ filePath: requested, requested, action: 'Writing' });
  assertNotGitDir({ relativePath: requested, requested });
  const real = await workspace.resolveWrite(requested);

  assertNotEnvFile({ filePath: real, requested, action: 'Writing' });
  assertNotGitDir({ relativePath: workspace.relative(real), requested });

  return real;
}

/**
 * Who a file tool's call is for, as `FileReads` names it: the session making the call, so the main
 * agent and each sub-agent are told apart. A call with no session (a tool run on its own) is the
 * only agent there is.
 */
export function agentOf(context: ToolContext): string {
  return context.session?.id ?? 'no-session';
}

/** The file's current content, or `null` if it doesn't exist yet. */
export async function readIfExists(params: {
  file: string;
  signal: AbortSignal;
}): Promise<string | null> {
  const { file, signal } = params;

  try {
    return await readFile(file, { encoding: 'utf8', signal });
  } catch (caughtError) {
    if ((caughtError as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw caughtError;
  }
}

/** Writes UTF-8 text. */
export async function writeText(params: {
  file: string;
  content: string;
  signal: AbortSignal;
}): Promise<void> {
  const { file, content, signal } = params;

  await writeFile(file, content, { encoding: 'utf8', signal });
}
