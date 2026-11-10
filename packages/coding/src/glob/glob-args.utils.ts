import { GREP_EXCLUDE_ARGS } from '../ripgrep/ripgrep.constants.js';

/**
 * The ripgrep arguments listing the files that match `pattern`. `--no-config` keeps the user's
 * ripgrep config out. Globs are case-insensitive, so the excludes also catch `.ENV` and `.Git`;
 * they come after the agent's pattern because ripgrep lets a later glob win. The path goes
 * behind `--` so it cannot be read as a flag. The excludes do not apply to a root path named on
 * the command line, so the tool checks that path itself before calling this.
 */
export function globArgs(params: { pattern: string; searchPath: string }): string[] {
  const { pattern, searchPath } = params;

  return [
    '--no-config',
    '--null',
    '--files',
    '--color',
    'never',
    '--sort',
    'path',
    '--glob-case-insensitive',
    `--glob=${pattern}`,
    ...GREP_EXCLUDE_ARGS,
    '--',
    searchPath,
  ];
}
