import { OutputError } from '@sheavly/core/errors/output.errors';
import type { OutputWriter } from '@sheavly/core/output/output.types';
import type { OutputCapture } from '@sheavly/extension/run-services/run-services.types';
import type { OutputLog } from '@sheavly/protocol/output/output.types';
import { errorCode } from '@sheavly/runtime/errors/errors.utils';
import type { Capture } from './run-command.types.js';

/**
 * Closes a capture without letting a failing close replace the command's own result or error:
 * the log is then reported incomplete. The reason is the error code only, since a message can carry
 * a path and the reason reaches the model.
 */
export async function closeCapture(writer: OutputWriter): Promise<OutputLog> {
  try {
    return await writer.close();
  } catch (caughtError) {
    return {
      ...writer.log,
      status: 'incomplete',
      reason: `closing the stored output failed (${errorCode(caughtError) ?? 'unknown error'})`,
    };
  }
}

/**
 * Starts the complete-output capture for one command. A store that cannot take one does not stop
 * the command: it runs with its bounded preview and the result says the full output is not kept,
 * so the absence is never mistaken for a complete log.
 */
export async function startCapture(outputs: OutputCapture | undefined): Promise<Capture> {
  if (!outputs) return undefined;

  try {
    return { writer: await outputs.create() };
  } catch (caughtError) {
    // An OutputError's message is written for the model and carries no path; any other error
    // is shown by its code only.
    if (caughtError instanceof OutputError) return { unavailable: caughtError.message };

    return { unavailable: `storage error: ${errorCode(caughtError) ?? 'unavailable'}` };
  }
}
