import path from 'node:path';
import { MAX_GREP_RESULTS } from './grep.constants.js';
import type { GrepCount, GrepMatch, GrepMode, GrepResult } from './grep.types.js';

/** `./src/a.ts` as ripgrep prints it for a search of `.` becomes `src/a.ts`. */
function tidyPath(printed: string): string {
  return path.normalize(printed).split(path.sep).join('/');
}

/** One printed record: the path, then what follows the NUL ripgrep puts after it. */
type RawRecord = { file: string; rest: string };

/**
 * Reads `path<NUL>rest<newline>` records in order: the path runs to the first NUL, and the rest to
 * the next newline. A path may itself hold a newline or a colon, so splitting on newlines first
 * would break it. A last record without its newline was cut off and is dropped.
 */
function readRecords(stdout: string): RawRecord[] {
  const records: RawRecord[] = [];
  let position = 0;

  while (position < stdout.length) {
    const nul = stdout.indexOf('\0', position);
    const end = nul === -1 ? -1 : stdout.indexOf('\n', nul);

    if (end === -1) break;
    records.push({ file: tidyPath(stdout.slice(position, nul)), rest: stdout.slice(nul + 1, end) });
    position = end + 1;
  }

  return records;
}

/** `files` mode prints `path<NUL>` with no newline; a last path without its NUL was cut off. */
function readFiles(stdout: string): string[] {
  const paths = stdout.split('\0');

  paths.pop();

  return paths.map(tidyPath);
}

function readMatches(stdout: string): GrepMatch[] {
  return readRecords(stdout).flatMap(({ file, rest }) => {
    const colon = rest.indexOf(':');
    const line = Number(rest.slice(0, colon));

    return colon === -1 || !Number.isInteger(line)
      ? []
      : [{ path: file, line, text: rest.slice(colon + 1) }];
  });
}

function readCounts(stdout: string): GrepCount[] {
  return readRecords(stdout).flatMap(({ file, rest }) => {
    const count = Number(rest);

    return Number.isInteger(count) ? [{ path: file, count }] : [];
  });
}

/**
 * Turns ripgrep's `--null` output into the artifact: the results for the mode asked, at most
 * `MAX_GREP_RESULTS` of them. `cut` says ripgrep was stopped early, so `truncated` is true even
 * when what was read fits.
 */
export function grepResult(params: {
  pattern: string;
  searched: string;
  mode: GrepMode;
  stdout: string;
  cut: boolean;
  skipped: string;
}): GrepResult {
  const { pattern, searched, mode, stdout, cut, skipped } = params;
  const base = { kind: 'grep_matches' as const, pattern, searched, skipped };
  const truncated = (found: number) => cut || found > MAX_GREP_RESULTS;

  if (mode === 'files') {
    const files = readFiles(stdout);

    return {
      ...base,
      mode,
      files: files.slice(0, MAX_GREP_RESULTS),
      truncated: truncated(files.length),
    };
  }

  if (mode === 'count') {
    const counts = readCounts(stdout);

    return {
      ...base,
      mode,
      counts: counts.slice(0, MAX_GREP_RESULTS),
      truncated: truncated(counts.length),
    };
  }

  const matches = readMatches(stdout);

  return {
    ...base,
    mode,
    matches: matches.slice(0, MAX_GREP_RESULTS),
    truncated: truncated(matches.length),
  };
}
