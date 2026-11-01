import { z } from 'zod';
import { defineTool } from '@sheavly/core/tool/tool.service';
import { withFileLock } from '../../runtime/file-locks/file-locks.service.js';
import type { Workspace } from '../../runtime/workspace/workspace.service.js';
import { readIfExists, resolveWritable, writeText } from '../files/files.service.js';
import { describeChange } from '../files/files.utils.js';
import { applyEdit } from './edit-file.utils.js';

/**
 * Replaces an exact piece of text in an existing file. The text must occur exactly once (or
 * set `replaceAll`), so an ambiguous edit is refused instead of changing the wrong place.
 * The result carries the file's before/after content, for a UI to show the diff.
 */
export function createEditFileTool({ workspace }: { workspace: Workspace }) {
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

      return withFileLock({
        file: real,
        signal,
        change: async () => {
          const before = await readIfExists({ file: real, signal });

          if (before === null) {
            throw new Error(`File not found: ${requested}. Use write_file to create it.`);
          }

          const { after, count } = applyEdit({ before, oldText, newText, replaceAll, requested });

          await writeText({ file: real, content: after, signal });

          const relative = workspace.relative(real);
          const replaced = count > 1 ? `, ${count} replacements` : '';
          const described = describeChange({ verb: 'Edited', path: relative, before, after });

          return {
            content: `${described}${replaced}`,
            change: { path: relative, before, after },
          };
        },
      });
    },
  });
}
