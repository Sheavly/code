import { rgPath } from '@vscode/ripgrep';
import { z } from 'zod';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { assertRanToTheEnd, resolveSearchRoot, runRipgrep } from '../ripgrep/ripgrep.helper.js';
import type { RipgrepToolDeps } from '../ripgrep/ripgrep.types.js';
import { MAX_GLOB_RESULTS, MAX_GLOB_SCANNED } from './glob.constants.js';
import type { GlobResult } from './glob.types.js';
import { globArgs } from './glob-args.utils.js';
import { formatGlob } from './glob-format.utils.js';
import { sortNewestFirst } from './glob-newest.helper.js';
import { readFilePaths } from './glob-output.utils.js';

/**
 * Lists the workspace files whose path matches a glob, most recently modified first. `.env` files
 * and `.git` are never listed, and a path outside the workspace is refused. At most
 * `MAX_GLOB_RESULTS` files are returned, with a note when there were more. `ripgrepPath` is the
 * binary to run; it defaults to the one `@vscode/ripgrep` ships.
 */
export function createGlobTool({ workspace, processes, ripgrepPath = rgPath }: RipgrepToolDeps) {
  return defineTool({
    name: 'glob',
    description:
      'Find files by name pattern, newest first. pattern is a glob such as "*.ts" or ' +
      '"src/**/*.test.ts" (case-insensitive). Searches the whole workspace, or the folder in path ' +
      '(relative to the workspace root). Respects .gitignore; .env files and .git are never listed. ' +
      `At most ${MAX_GLOB_RESULTS} files are returned and the output says when more were cut, so ` +
      'narrow the pattern instead of repeating it.',
    inputSchema: z.object({
      pattern: z.string().min(1).describe('Glob to match file paths against, e.g. "**/*.ts"'),
      path: z
        .string()
        .optional()
        .describe('Folder to search, relative to the workspace root (default: all of it)'),
    }),
    execute: async ({ input, signal }) => {
      const { pattern, path: requested = '.' } = input;

      const searched = await resolveSearchRoot({ workspace, requested });
      const run = await runRipgrep({
        processes,
        file: ripgrepPath,
        args: globArgs({ pattern, searchPath: searched }),
        cwd: workspace.root,
        signal,
      });

      assertRanToTheEnd(run);

      const found = readFilePaths(run.stdout);
      const scanned = found.slice(0, MAX_GLOB_SCANNED);
      const newest = await sortNewestFirst({ root: workspace.root, files: scanned, signal });
      const result: GlobResult = {
        kind: 'glob_files',
        pattern,
        searched,
        files: newest.slice(0, MAX_GLOB_RESULTS),
        truncated: run.cut || found.length > MAX_GLOB_SCANNED || newest.length > MAX_GLOB_RESULTS,
        skipped: run.exitCode === 2 ? run.stderr.trim() : '',
      };

      return { content: formatGlob(result), artifacts: [result] };
    },
  });
}
