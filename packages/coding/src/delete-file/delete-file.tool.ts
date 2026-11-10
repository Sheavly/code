import { z } from 'zod';
import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import type { FileLocks } from '@sheavly/workspace/file-locks/file-locks.service';
import type { FileReads } from '@sheavly/workspace/file-reads/file-reads.service';
import type { Workspace } from '@sheavly/workspace/workspace/workspace.service';
import { readIfExists, removeFile, resolveDeletable } from '../files/files.helper.js';
import { describeChange } from '../files/files.utils.js';
import type { FileChange } from '../files/files.types.js';

/**
 * Removes one file from the workspace, and refuses a folder, a symlink, a `.env` file and anything
 * outside the workspace. The result carries the content the file held, for a UI to show it as
 * deleted; a file already gone is an error, never a silent success, since the delete may have been
 * meant for another path.
 *
 * `fileLocks` is the harness's, as in `write_file` and `edit_file`: a delete and a write of one
 * file take their turns, so a delete never removes a file another call is about to change.
 * `fileReads` is told the file is gone, so what an agent was shown of it can't let an edit through
 * a file later created at that path.
 */
export function createDeleteFileTool({
  workspace,
  fileLocks,
  fileReads,
}: {
  workspace: Workspace;
  fileLocks: FileLocks;
  fileReads: FileReads;
}) {
  return defineTool({
    name: 'delete_file',
    description:
      'Delete one file. Paths are relative to the workspace root. It refuses a folder, a ' +
      'symlink, .env files and paths outside the workspace; to remove a folder, use ' +
      'run_command.',
    inputSchema: z.object({
      path: z.string().min(1).describe('File path, relative to the workspace root'),
    }),
    execute: async ({ input: { path: requested }, signal }) => {
      const real = await resolveDeletable({ workspace, requested });

      return fileLocks.run({
        file: real,
        signal,
        change: async () => {
          const before = await readIfExists({ file: real, signal });

          if (before === null) {
            throw new ToolCallError({
              reason: 'not_found',
              message: `File not found: ${requested}. It may already be deleted.`,
            });
          }

          await removeFile({ file: real });
          fileReads.markDeleted({ file: real });

          const relative = workspace.relative(real);
          const change: FileChange = {
            kind: 'file_change',
            path: relative,
            before,
            after: null,
          };

          return {
            content: describeChange({
              verb: 'Deleted',
              path: relative,
              before,
              after: null,
            }),
            artifacts: [change],
          };
        },
      });
    },
  });
}
