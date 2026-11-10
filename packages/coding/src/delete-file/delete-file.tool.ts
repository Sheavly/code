import { z } from 'zod';
import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import type { FileToolServices } from '../files/files.types.js';
import { fileSize, readForChange, removeFile } from '../files/file-effects.helper.js';
import { changeResult } from '../files/file-change.helper.js';
import { assertSameDeletable, resolveDeletable } from '../files/files.helper.js';
import { MAX_DELETE_BYTES } from './delete-file.constants.js';

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
          // Resolved before the lock to queue on the file, then again under it: a path swapped
          // while the delete waited would otherwise be read or removed without the guards.
          await assertSameDeletable({ workspace, requested, expected: real });
          await assertReadableSize({ requested, file: real });

          const before = await readForChange({
            file: real,
            requested,
            signal,
            hint: 'It may already be deleted.',
          });

          assertReportedSize({ requested, content: before });

          // Node has no unlink-by-handle, so the unlink is a fresh path lookup after this check: a
          // parent swapped in that last moment is the one case neither check can close.
          await assertSameDeletable({ workspace, requested, expected: real });
          await removeFile({ file: real, signal });
          fileReads.markDeleted({ file: real });

          return changeResult({ workspace, file: real, verb: 'Deleted', before, after: null });
        },
      });
    },
  });
}

/** The refusal for a file too large to report in a `FileChange`. */
function tooLarge(params: { requested: string; size: number }): ToolCallError {
  const { requested, size } = params;

  return new ToolCallError({
    reason: 'invalid_input',
    message:
      `${requested} is ${size} bytes, more than the ${MAX_DELETE_BYTES} bytes a delete reports. ` +
      'Remove it with run_command (rm) instead, so its content is not read into the result.',
  });
}

/** Refuses a file already larger than a deletion reports, before its content is read. */
async function assertReadableSize(params: { requested: string; file: string }): Promise<void> {
  const { requested, file } = params;
  const size = await fileSize({ file });

  if (size > MAX_DELETE_BYTES) throw tooLarge({ requested, size });
}

/** Refuses content that grew past the limit between the size check and the read. */
function assertReportedSize(params: { requested: string; content: string }): void {
  const { requested, content } = params;
  const size = Buffer.byteLength(content, 'utf8');

  if (size > MAX_DELETE_BYTES) throw tooLarge({ requested, size });
}
