import { outputReferenceLines } from '@sheavly/core/output/output.utils';
import type { OutputStore } from '@sheavly/core/output/output.types';
import type { OutputLog } from '@sheavly/protocol/output/output.types';
import type { FileReads } from '@sheavly/workspace/file-reads/file-reads.service';
import type { ProcessRunner } from '@sheavly/workspace/process/process.service';
import type { ScriptParams } from '@sheavly/workspace/process/process.types';
import { closeCapture, startCapture } from './capture.helper.js';
import type { Capture } from './run-command.types.js';
import { formatResult } from './run-command.utils.js';

/**
 * Runs a command to its end and returns its result with the output reference. The capture is
 * closed whatever happens (a timeout, an abort, a command that cannot start), so what was printed
 * before the failure stays readable; an abort or a start failure still throws as before.
 */
export async function runForeground(params: {
  command: string;
  script: ScriptParams;
  processes: ProcessRunner;
  outputs: OutputStore | undefined;
  fileReads: FileReads;
}): Promise<string> {
  const { command, script, processes, outputs, fileReads } = params;
  const capture = await startCapture(outputs);
  const writer = capture && 'writer' in capture ? capture.writer : undefined;

  try {
    const result = await processes.runScript({
      ...script,
      onOutput: (chunk) => writer?.append(chunk),
    });
    const log = writer && (await closeCapture(writer));

    return formatResult({
      command,
      result,
      outputLines: finishedOutputLines({ capture, log, preview: result.output }),
    });
  } catch (caughtError) {
    const log = writer && (await closeCapture(writer));

    // The call fails, so the result lines never reach the model: name the log in the error instead.
    if (log && caughtError instanceof Error && log.bytes > 0) {
      caughtError.message += `\nOutput printed before the failure is stored: output_ref=${log.ref}. Read it with read_output or search_output.`;
    }

    throw caughtError;
  } finally {
    // Whatever the command did to the files, even a failed or aborted one may have done part of it.
    fileReads.markAllUnknown();
  }
}

/** The lines after a finished command: its reference, or why there is none. */
function finishedOutputLines(params: {
  capture: Capture;
  log: OutputLog | undefined;
  preview: string;
}): string[] {
  const { capture, log, preview } = params;

  if (capture && 'unavailable' in capture) return [unavailableLine(capture.unavailable)];

  return outputReferenceLines({ log, shown: preview });
}

/** The lines for a command just started in the background. */
export function startedOutputLines(params: {
  capture: Capture;
  log: OutputLog | undefined;
}): string[] {
  const { capture, log } = params;

  if (capture && 'unavailable' in capture) return [unavailableLine(capture.unavailable)];
  if (!log) return [];

  return [
    `Output so far and when it ends: output_ref=${log.ref}. Read it with read_output or find text with search_output; a running task's log grows until it ends.`,
  ];
}

function unavailableLine(reason: string): string {
  return `Full output is NOT being stored (${reason}). Only the shortened preview exists; do not assume it is complete.`;
}
