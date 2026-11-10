import { StringDecoder } from 'node:string_decoder';
import { Writable } from 'node:stream';
import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import type { ProcessRunner } from '@sheavly/workspace/process/process.service';
import { GREP_TIMEOUT_MS, MAX_GREP_RAW_CHARS } from './grep.constants.js';
import type { RipgrepRun } from './grep.types.js';

/**
 * Runs ripgrep with its standard output going to a collector of its own, not the runner's
 * output buffer: that one keeps only a head and a tail, which would break the records being
 * parsed. Past `MAX_GREP_RAW_CHARS` the collector closes, and the runner stops ripgrep as it
 * would a closed pipe.
 */
export async function runRipgrep(params: {
  processes: ProcessRunner;
  file: string;
  args: string[];
  cwd: string;
  signal: AbortSignal;
}): Promise<RipgrepRun> {
  const { processes, file, args, cwd, signal } = params;
  const decoder = new StringDecoder('utf8');
  let stdout = '';
  let cut = false;
  const collector = new Writable({
    write(chunk: Buffer, _encoding, done) {
      stdout += decoder.write(chunk);
      done();

      if (stdout.length <= MAX_GREP_RAW_CHARS) return;

      cut = true;
      stdout = stdout.slice(0, MAX_GREP_RAW_CHARS);
      this.destroy();
    },
  });

  const result = await processes.run({
    file,
    args,
    cwd,
    shell: false,
    signal,
    timeoutMs: GREP_TIMEOUT_MS,
    stdoutTo: collector,
  });

  // A multibyte character cut off at the end of the output is flushed, not lost.
  if (!cut) stdout += decoder.end();

  return {
    stdout,
    stderr: result.output,
    exitCode: result.exitCode,
    cut,
    timedOut: result.timedOut,
  };
}

/**
 * Throws unless ripgrep ran to the end, or was stopped on purpose for printing too much. Exit 0
 * (matches) and 1 (none) are results. Exit 2 is an error, but ripgrep also uses it when it only
 * skipped a file it could not read, so with output it is a partial result the caller reports.
 * Anything else (a signal, no exit code) is a failure, never "no matches".
 */
export function assertRanToTheEnd(run: RipgrepRun): void {
  if (run.timedOut) {
    throw new ToolCallError({
      reason: 'invalid_input',
      message: `The search took longer than ${GREP_TIMEOUT_MS / 1000}s and was stopped. Narrow it with path or glob.`,
    });
  }

  if (run.cut || run.exitCode === 0 || run.exitCode === 1) return;

  if (run.exitCode === 2 && run.stdout !== '') return;

  throw new ToolCallError({
    reason: 'invalid_input',
    message: run.stderr.trim() || `ripgrep failed (exit ${run.exitCode ?? 'by signal'}).`,
  });
}
