import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import type { ToolContext } from '@sheavly/core/tool/tool.types';
import type { Workspace } from '@sheavly/workspace/workspace/workspace.service';
import type { FileChange, FileChangeVerb } from './files.types.js';
import { assertNotEnvFile, assertNotGitDir, describeChange } from './files.utils.js';

/**
 * Resolves a path the agent may write to: inside the workspace (`resolveWrite` rejects `../`,
 * absolute paths outside and symlinks out), never a .env file and never inside `.git`, before
 * and after symlinks.
 */
export function resolveWritable(params: {
  workspace: Workspace;
  requested: string;
}): Promise<string> {
  const { workspace, requested } = params;

  return resolveGuarded({
    workspace,
    requested,
    action: 'Writing',
    resolve: (asking) => workspace.resolveWrite(asking),
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
}): Promise<string> {
  const { workspace, requested } = params;

  return resolveGuarded({
    workspace,
    requested,
    action: 'Deleting',
    resolve: () => resolveExisting({ workspace, requested }),
  });
}

/** `resolveDelete`, with a missing path turned into the tool error a caller expects. */
async function resolveExisting(params: {
  workspace: Workspace;
  requested: string;
}): Promise<string> {
  const { workspace, requested } = params;

  try {
    return await workspace.resolveDelete(requested);
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

/**
 * The content of a file the change expects to exist, read under its lock. A missing file fails as
 * `not_found`, with `hint` saying what to do instead: creating it, or looking for the delete that
 * already happened.
 */
export async function readForChange(params: {
  file: string;
  requested: string;
  signal: AbortSignal;
  hint: string;
}): Promise<string> {
  const { file, requested, signal, hint } = params;
  const before = await readIfExists({ file, signal });

  if (before === null) {
    throw new ToolCallError({
      reason: 'not_found',
      message: `File not found: ${requested}. ${hint}`,
    });
  }

  return before;
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

/** Creates the folders a file's path needs, so a file can be written into them. */
export async function createParentFolder(params: { file: string }): Promise<void> {
  await mkdir(path.dirname(params.file), { recursive: true });
}

/**
 * Removes one file. A path that is already gone fails with ENOENT, so nothing pretends to have
 * deleted what it did not; a folder is never removed (`rm` without `recursive` refuses one).
 * Node's `rm` takes no abort signal: removing one file is a single call, so an interrupt can only
 * land before or after it. Windows can hold a file briefly after another handle closes, so `rm`
 * retries the errors that reports instead of failing the call.
 */
export async function removeFile(params: { file: string }): Promise<void> {
  await rm(params.file, { maxRetries: 3, retryDelay: 100 });
}

/**
 * The result a file tool returns for a change: the one-line description a model reads, and the
 * `FileChange` artifact a UI renders. Built together so a tool can't report a path or a content
 * pair the other doesn't see; `suffix` adds to the description (an edit's replacement count).
 */
export function changeResult(params: {
  workspace: Workspace;
  file: string;
  verb: FileChangeVerb;
  before: string | null;
  after: string | null;
  suffix?: string;
}): { content: string; artifacts: FileChange[] } {
  const { workspace, file, verb, before, after, suffix = '' } = params;
  const relative = workspace.relative(file);
  const change: FileChange = { kind: 'file_change', path: relative, before, after };

  return {
    content: `${describeChange({ verb, path: relative, before, after })}${suffix}`,
    artifacts: [change],
  };
}
