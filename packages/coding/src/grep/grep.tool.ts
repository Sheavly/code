import { rgPath } from '@vscode/ripgrep';
import { z } from 'zod';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import type { ProcessRunner } from '@sheavly/workspace/process/process.service';
import type { Workspace } from '@sheavly/workspace/workspace/workspace.service';
import { assertNotEnvFile, assertNotGitDir } from '../files/files.utils.js';
import { GREP_MODES, MAX_GREP_RESULTS } from './grep.constants.js';
import { assertRanToTheEnd, runRipgrep } from './grep.helper.js';
import { grepArgs } from './grep-args.utils.js';
import { formatGrep } from './grep-format.utils.js';
import { grepResult } from './grep-output.utils.js';

/**
 * Searches the files under a workspace path with ripgrep (a regex, optionally limited by a glob),
 * returning matching lines, the files that match, or a count per file. `.env` files and `.git` are
 * never searched, whatever the pattern or glob, and a path outside the workspace is refused.
 * Results are cut at `MAX_GREP_RESULTS` with a note saying so. `ripgrepPath` is the binary to
 * run; it defaults to the one `@vscode/ripgrep` ships.
 */
export function createGrepTool({
  workspace,
  processes,
  ripgrepPath = rgPath,
}: {
  workspace: Workspace;
  processes: ProcessRunner;
  ripgrepPath?: string;
}) {
  return defineTool({
    name: 'grep',
    description:
      'Search file contents with ripgrep (a regular expression). Searches the whole workspace, or ' +
      'the file or folder in path (relative to the workspace root). Respects .gitignore; .env files ' +
      'and .git are never searched. mode content (default) returns path:line:text, files only the ' +
      'paths that match, count the number of matching lines per file. glob limits which files are ' +
      `searched, e.g. "*.ts", and ignores case. At most ${MAX_GREP_RESULTS} results are returned and the output says ` +
      'when more were cut, so narrow the search instead of repeating it.',
    inputSchema: z.object({
      pattern: z.string().min(1).describe('Regular expression to search for (Rust regex syntax)'),
      path: z
        .string()
        .optional()
        .describe('File or folder to search, relative to the workspace root (default: all of it)'),
      glob: z.string().optional().describe('Only search files matching this glob, e.g. "*.ts"'),
      mode: z.enum(GREP_MODES).default('content').describe('What to return (default content)'),
      caseInsensitive: z.boolean().optional().describe('Ignore case (default: case-sensitive)'),
    }),
    execute: async ({ input, signal }) => {
      const { pattern, path: requested = '.', glob, mode, caseInsensitive } = input;

      // ripgrep applies its excludes to what it walks, never to a root path it is given, so the
      // requested path is checked here, by name and after symlinks.
      assertNotEnvFile({ filePath: requested, requested, action: 'Searching' });
      assertNotGitDir({ relativePath: requested, requested, action: 'Searching' });
      const real = await workspace.resolveRead(requested); // rejects escapes, follows symlinks
      const searched = workspace.relative(real);

      assertNotEnvFile({ filePath: real, requested, action: 'Searching' });
      assertNotGitDir({ relativePath: searched, requested, action: 'Searching' });
      const run = await runRipgrep({
        processes,
        file: ripgrepPath,
        args: grepArgs({ pattern, mode, searchPath: searched, glob, caseInsensitive }),
        cwd: workspace.root,
        signal,
      });

      assertRanToTheEnd(run);

      const skipped = run.exitCode === 2 ? run.stderr.trim() : '';
      const result = grepResult({
        pattern,
        searched,
        mode,
        stdout: run.stdout,
        cut: run.cut,
        skipped,
      });

      return { content: formatGrep({ result, skipped }), artifacts: [result] };
    },
  });
}
