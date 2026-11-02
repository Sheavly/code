import { z } from 'zod';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import type { FileChange } from '../files/files.types.js';
import type { FileLocks } from '@sheavly/workspace/file-locks/file-locks.service';
import type { Workspace } from '@sheavly/workspace/workspace/workspace.service';
import { readIfExists, resolveWritable, writeText } from '../files/files.helper.js';
import { describeChange } from '../files/files.utils.js';
import { applyEdit } from './edit-file.utils.js';
import { ToolCallError } from '@sheavly/core/errors/tool.errors';

/**
 * Replaces an exact piece of text in an existing file. The text must occur exactly once (or
 * set `replaceAll`), so an ambiguous edit is refused instead of changing the wrong place.
 * The result carries the file's before/after content, for a UI to show the diff.
 *
 * `fileLocks` orders changes to the same file. It's required, not defaulted: every writer of a
 * file must share one instance (the harness's), and a tool that made its own would silently let
 * a parallel write or edit overlap.
 */
export function createEditFileTool({
  workspace,
  fileLocks,
}: {
  workspace: Workspace;
  fileLocks: FileLocks;
}) {
  return defineTool({
    name: 'edit_file',
    description:
      'Replace exact text in an existing file. `oldText` must match the file exactly ' +
      '(including whitespace) and occur once, unless `replaceAll` is true. Read the file first.',
    inputSchema: z.object({
      path: z.string().min(1).describe('File path, relative to the workspace root'),
      oldText: z.string().min(1).describe('The exact text to replace'),
      newText: z.string().describe('The text to put in its place'),
      replaceAll: z.boolean().optional().describe('Replace every occurrence (default: only one)'),
    }),
    execute: async ({ input, signal }) => {
      const { path: requested, oldText, newText, replaceAll = false } = input;
      const real = await resolveWritable({ workspace, requested });

      return fileLocks.run({
        file: real,
        signal,
        change: async () => {
          const before = await readIfExists({ file: real, signal });

          if (before === null) {
            throw new ToolCallError({
              reason: 'not_found',
              message: `File not found: ${requested}. Use write_file to create it.`,
            });
          }

          const { after, count } = applyEdit({ before, oldText, newText, replaceAll, requested });

          await writeText({ file: real, content: after, signal });

          const relative = workspace.relative(real);
          const replaced = count > 1 ? `, ${count} replacements` : '';
          const described = describeChange({ verb: 'Edited', path: relative, before, after });
          const change: FileChange = { kind: 'file_change', path: relative, before, after };

          return { content: `${described}${replaced}`, artifacts: [change] };
        },
      });
    },
  });
}
