import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import { errorCode, isMissingPath } from '@sheavly/runtime/errors/errors.utils';
import { PathCheckError, WorkspaceError } from '@sheavly/workspace/errors/workspace.errors';
import { FS_REFUSALS } from './files.constants.js';

/**
 * Runs the body of a file tool with the one abort rule and the one error mapping they share. An
 * already aborted call fails before it touches the disk. A path that is not there becomes
 * `not_found`, a path the workspace refused or could not check becomes `forbidden`, each with the
 * path the model asked for, so no raw `ENOENT` or `EACCES` reaches it. A `ToolCallError`, an abort
 * and any other failure pass through unchanged.
 */
export async function runFileTool<T>(params: {
  requested: string;
  signal: AbortSignal;
  run: () => Promise<T>;
}): Promise<T> {
  const { requested, signal, run } = params;

  signal.throwIfAborted();

  try {
    return await run();
  } catch (caughtError) {
    throw toToolError({ error: caughtError, requested, signal });
  }
}

/** The tool error a failure of a file tool stands for, or the failure itself when none does. */
function toToolError(params: { error: unknown; requested: string; signal: AbortSignal }): unknown {
  const { error, requested, signal } = params;

  // An abort is the loop's to handle, whatever it surfaced as.
  if (signal.aborted || error instanceof ToolCallError) return error;

  if (isMissingPath(error)) {
    return new ToolCallError({ reason: 'not_found', message: `File not found: ${requested}.` });
  }

  // Its text can carry the system's message and an absolute path, so the model gets a fixed one.
  if (error instanceof PathCheckError) {
    return new ToolCallError({
      reason: 'forbidden',
      message: `Could not check ${requested}${error.code ? ` (${error.code})` : ''}.`,
    });
  }

  if (error instanceof WorkspaceError) {
    return new ToolCallError({ reason: 'forbidden', message: error.message });
  }

  // The system's own text carries absolute host paths, so the model gets a fixed sentence.
  const code = errorCode(error);

  if (code !== undefined && FS_REFUSALS[code] !== undefined) {
    return new ToolCallError({
      reason: 'forbidden',
      message: `${FS_REFUSALS[code]}: ${requested}.`,
    });
  }

  return error;
}
