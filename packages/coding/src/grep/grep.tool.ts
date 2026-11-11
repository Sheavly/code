import { rgPath } from '@vscode/ripgrep';
import { z } from 'zod';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { assertRanToTheEnd, resolveSearchRoot, runRipgrep } from '../ripgrep/ripgrep.helper.js';
import type { RipgrepToolDeps } from '../ripgrep/ripgrep.types.js';
import { GREP_MODES } from './grep.constants.js';
import { GREP_PROMPTS } from './grep.prompt.js';
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
export function createGrepTool({ workspace, processes, ripgrepPath = rgPath }: RipgrepToolDeps) {
  return defineTool({
    name: 'grep',
    description: GREP_PROMPTS.description,
    inputSchema: z.object({
      pattern: z.string().min(1).describe(GREP_PROMPTS.pattern),
      path: z.string().optional().describe(GREP_PROMPTS.path),
      glob: z.string().optional().describe(GREP_PROMPTS.glob),
      mode: z.enum(GREP_MODES).default('content').describe(GREP_PROMPTS.mode),
      caseInsensitive: z.boolean().optional().describe(GREP_PROMPTS.caseInsensitive),
    }),
    execute: async ({ input, signal }) => {
      const { pattern, path: requested = '.', glob, mode, caseInsensitive } = input;

      const searched = await resolveSearchRoot({ workspace, requested });
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
