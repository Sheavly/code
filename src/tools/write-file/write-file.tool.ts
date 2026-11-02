import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { withFileLock } from '../../runtime/file-locks/file-locks.helper.js';
import type { Workspace } from '../../runtime/workspace/workspace.service.js';
import { readIfExists, resolveWritable, writeText } from '../files/files.service.js';
import { describeChange } from '../files/files.utils.js';

/**
 * Creates or overwrites a UTF-8 text file inside the workspace (creating parent folders).
 * The result carries the file's before/after content, for a UI to show the diff.
 */
export function createWriteFileTool({ workspace }: { workspace: Workspace }) {
  return defineTool({
    name: 'write_file',
    description:
      'Create a file, or replace a file with new content. Paths are relative to the workspace ' +
      'root; missing folders are created. To change part of an existing file, use edit_file.',
    inputSchema: z.object({
      path: z.string().min(1).describe('File path, relative to the workspace root'),
      content: z.string().describe('The complete new content of the file'),
    }),
    execute: async ({ input: { path: requested, content }, signal }) => {
      const real = await resolveWritable({ workspace, requested });

      return withFileLock({
        file: real,
        signal,
        change: async () => {
          const before = await readIfExists({ file: real, signal });

          await mkdir(path.dirname(real), { recursive: true });
          await writeText({ file: real, content, signal });

          const relative = workspace.relative(real);
          const verb = before === null ? 'Created' : 'Overwrote';

          return {
            content: describeChange({ verb, path: relative, before, after: content }),
            change: { path: relative, before, after: content },
          };
        },
      });
    },
  });
}
