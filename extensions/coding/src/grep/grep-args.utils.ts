import { GREP_EXCLUDE_ARGS } from '../ripgrep/ripgrep.constants.js';
import { GREP_MODE_FLAGS, MAX_GREP_LINE_CHARS } from './grep.constants.js';
import type { GrepMode } from './grep.types.js';

/**
 * The ripgrep arguments for one search. `--no-config` keeps the user's ripgrep config out. Globs
 * are case-insensitive, so the excludes also catch `.ENV` and `.Git`, which the file guards treat
 * as the same names; they come after the agent's `glob` because ripgrep lets a later glob win.
 * The pattern goes behind `--regexp` and the path behind `--`, so neither can be read as a flag.
 * The excludes do not apply to a root path named on the command line, so the tool checks that
 * path itself before calling this.
 */
export function grepArgs(params: {
  pattern: string;
  mode: GrepMode;
  searchPath: string;
  glob?: string | undefined;
  caseInsensitive?: boolean | undefined;
}): string[] {
  const { pattern, mode, searchPath, glob, caseInsensitive } = params;

  return [
    '--no-config',
    '--null',
    '--with-filename',
    '--no-heading',
    '--color',
    'never',
    '--sort',
    'path',
    '--max-columns',
    String(MAX_GREP_LINE_CHARS),
    '--max-columns-preview',
    GREP_MODE_FLAGS[mode],
    ...(caseInsensitive ? ['--ignore-case'] : []),
    '--glob-case-insensitive',
    ...(glob ? ['--glob', glob] : []),
    ...GREP_EXCLUDE_ARGS,
    '--regexp',
    pattern,
    '--',
    searchPath,
  ];
}
