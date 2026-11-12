import type { OutputWriter } from '@sheavly/core/output/output.types';
import type { OutputLog } from '@sheavly/protocol/output/output.types';
import { errorCode } from '../errors/errors.utils.js';

/**
 * Closes a task's capture and returns the log's final state. A close that fails does not stop the
 * task settling: the log is reported `incomplete` with the reason rather than left `capturing`.
 */
export async function closeTaskCapture(capture: OutputWriter): Promise<OutputLog> {
  try {
    return await capture.close();
  } catch (caughtError) {
    return {
      ...capture.log,
      status: 'incomplete',
      // The code only: an error's message can carry a path, and this reason reaches the model.
      reason: `closing the stored output failed (${errorCode(caughtError) ?? 'unknown error'})`,
    };
  }
}
