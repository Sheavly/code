import path from 'node:path';

/**
 * The paths in ripgrep's `--files --null` output. Paths are split on NUL, never on newlines,
 * since a path may hold a newline or a colon; a last path without its NUL was cut off and is
 * dropped. `./src/a.ts` as printed for a search of `.` becomes `src/a.ts`.
 */
export function readFilePaths(stdout: string): string[] {
  const paths = stdout.split('\0');

  paths.pop();

  return paths.map((printed) => path.normalize(printed).split(path.sep).join('/'));
}
