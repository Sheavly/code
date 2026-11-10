import { z } from 'zod';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import type { FileToolServices } from '../files/files.types.js';
import {
  changeResult,
  readForChange,
  removeFile,
  resolveDeletable,
} from '../files/files.helper.js';

/**
 * Removes one file from the workspace, and refuses a folder, a symlink, a `.env` file and anything
 * outside the workspace. The result carries the content the file held, for a UI to show it as
 * deleted; a file already gone is an error, never a silent success, since the delete may have been
 * meant for another path.
 *
 * Unlike `edit_file`, a delete is not gated on the agent having read the file: the call names a
 * path, not remembered text, and the content is read under the lock for the artifact. Its result is
 * the only record of what was there.
 *
 * `fileLocks` is the harness's, as in `write_file` and `edit_file`: a delete and a write of one
 * file take their turns, so a delete never removes a file another call is about to change.
 * `fileReads` is told the file is gone, so what an agent was shown of it can't let an edit through
 * a file later created at that path.
 */
export function createDeleteFileTool({ workspace, fileLocks, fileReads }: FileToolServices) {
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
          const before = await readForChange({
            file: real,
            requested,
            signal,
            hint: 'It may already be deleted.',
          });

          await removeFile({ file: real });
          fileReads.markDeleted({ file: real });

          return changeResult({ workspace, file: real, verb: 'Deleted', before, after: null });
        },
      });
    },
  });
}
