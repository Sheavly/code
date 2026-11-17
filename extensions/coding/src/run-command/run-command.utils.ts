import { MAX_OUTPUT_CHARS } from '@sheavly/process/process/process.constants';
import type {
  ProcessResult,
  ScriptParams,
  ScriptStep,
} from '@sheavly/process/process/process.types';
import {
  DIFF_SUBCOMMANDS,
  NO_DIFF_PROGRAM_FLAGS,
  SAFE_GIT_CONFIG,
} from './run-command.constants.js';

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

/** Git driver protections do not change approval or filter file operands of approved commands. */
export function safeSteps(steps: ScriptParams['steps']): ScriptParams['steps'] {
  const [first, ...rest] = steps.map(({ argv: [file, ...args], joinedBy }): ScriptStep => {
    const safe = safeGitArgs({ file, args });
    const argv: [string, ...string[]] = [file, ...safe];

    return joinedBy ? { argv, joinedBy } : { argv };
  });

  // `steps` is never empty, so neither is the result.
  return [first ?? steps[0], ...rest];
}

/** The tool result for a finished foreground command. */
export function formatResult(params: {
  command: string;
  result: ProcessResult;
  /** Where the complete output is kept, shown after the preview. */
  outputLines?: readonly string[];
}): string {
  const { command, result, outputLines = [] } = params;
  const { exitCode, output, timedOut } = result;
  const status = timedOut ? 'timed out' : `exit code ${exitCode ?? 'unknown'}`;
  const body =
    output.length >= MAX_OUTPUT_CHARS
      ? `${output.slice(0, MAX_OUTPUT_CHARS)}\n[output truncated]`
      : output;

  return [`$ ${command}`, `[${status}]`, body.trimEnd(), ...outputLines].filter(Boolean).join('\n');
}
