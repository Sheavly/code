import { MAX_OUTPUT_CHARS } from '@sheavly/workspace/process/process.constants';
import type { ProcessResult } from '@sheavly/workspace/process/process.types';
import { isAllowed, parseCommand } from './allow-list.utils.js';
import {
  DIFF_SUBCOMMANDS,
  NO_DIFF_PROGRAM_FLAGS,
  SAFE_GIT_CONFIG,
} from './run-command.constants.js';
import { ToolCallError } from '@sheavly/core/errors/tool.errors';

/**
 * The env that keeps a repo's config from making git run programs: `SAFE_GIT_CONFIG` as
 * `GIT_CONFIG_KEY_n` / `GIT_CONFIG_VALUE_n` (which override every config file), and no system
 * config.
 */
export function safeGitEnv(): Record<string, string> {
  const entries = Object.entries(SAFE_GIT_CONFIG);
  const env: Record<string, string> = {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_COUNT: String(entries.length),
  };

  entries.forEach(([key, value], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = key;
    env[`GIT_CONFIG_VALUE_${i}`] = value;
  });

  return env;
}

/**
 * `args` for `file`, with `--no-ext-diff --no-textconv` after a git subcommand that can run a
 * diff program (`git diff`, `log`, `show`), so diff drivers in the repo's config never run.
 */
export function safeGitArgs(params: { file: string; args: readonly string[] }): string[] {
  const { file, args } = params;
  const [subcommand = '', ...rest] = args;

  if (file !== 'git' || !DIFF_SUBCOMMANDS.includes(subcommand)) return [...args];

  return [subcommand, ...NO_DIFF_PROGRAM_FLAGS, ...rest];
}

/** Parses and checks a command against the allow list; returns argv or throws a clear reason. */
export function checkAllowed(params: {
  command: string;
  allowList: readonly string[];
}): [string, ...string[]] {
  const { command, allowList } = params;
  const parsed = parseCommand(command);

  if (!parsed.ok) {
    throw new ToolCallError({
      reason: 'forbidden',
      message: `Command rejected (${parsed.reason}): ${command}`,
    });
  }

  if (!isAllowed({ argv: parsed.argv, allowList })) {
    throw new ToolCallError({
      reason: 'forbidden',
      message: `Command not in allow list: ${command}\nAllowed: ${allowList.join(', ')}`,
    });
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
