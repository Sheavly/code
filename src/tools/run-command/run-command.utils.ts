import { MAX_OUTPUT_CHARS } from '../../runtime/process/process.constants.js';
import type { ProcessResult } from '../../runtime/process/process.types.js';
import { isAllowed, parseCommand } from './allow-list.utils.js';

/** Parses and checks a command against the allow list; returns argv or throws a clear reason. */
export function checkAllowed(params: {
  command: string;
  allowList: readonly string[];
}): [string, ...string[]] {
  const { command, allowList } = params;
  const parsed = parseCommand(command);

  if (!parsed.ok) throw new Error(`Command rejected (${parsed.reason}): ${command}`);

  if (!isAllowed({ argv: parsed.argv, allowList })) {
    throw new Error(`Command not in allow list: ${command}\nAllowed: ${allowList.join(', ')}`);
  }

  return parsed.argv as [string, ...string[]];
}

/** The tool result for a finished foreground command. */
export function formatResult(params: { command: string; result: ProcessResult }): string {
  const { command, result } = params;
  const { exitCode, output, timedOut } = result;
  const status = timedOut ? 'timed out' : `exit code ${exitCode ?? 'unknown'}`;
  const body =
    output.length >= MAX_OUTPUT_CHARS
      ? `${output.slice(0, MAX_OUTPUT_CHARS)}\n[output truncated]`
      : output;

  return `$ ${command}\n[${status}]\n${body}`.trimEnd();
}
