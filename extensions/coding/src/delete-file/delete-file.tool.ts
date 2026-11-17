import { hashText } from '@sheavly/workspace/file-reads/file-reads.utils';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import type { ToolContext } from '@sheavly/core/tool/tool.types';
import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import { fileSize, readForChange, removeFile } from '../files/file-effects.helper.js';
import { runFileTool } from '../files/file-tool.helper.js';
import type { FileToolServices } from '../files/files.types.js';
import { z } from 'zod';
import { changeResult } from '../files/file-change.helper.js';
import { assertSameDeletable, resolveDeletable } from '../files/files.helper.js';
import { agentOf } from '../files/files.utils.js';
import { currentRoot } from '../files/working-root.helper.js';
import { MAX_DELETE_BYTES } from './delete-file.constants.js';
import { DELETE_FILE_PROMPTS } from './delete-file.prompt.js';

/**
 * Removes one file from the workspace, and refuses a folder, a symlink, a `.env` file and anything
 * outside the workspace. The result carries the content the file held, for a UI to show it as
 * deleted; a file already gone is an error, never a silent success, since the delete may have been
 * meant for another path.
 *
 * Like `edit_file`, a delete is gated on the calling agent having read the file (`read_file`) or
 * made it, so it removes what the agent has seen, not a path it guessed. The content is read under
 * the lock for the artifact, whose result is the only record of what was there.
 *
 * `fileLocks` is the harness's, as in `write_file` and `edit_file`: a delete and a write of one
 * file take their turns, so a delete never removes a file another call is about to change.
 * `fileReads` is told the file is gone, so what an agent was shown of it can't let an edit through
 * a file later created at that path.
 */
export function createDeleteFileTool(services: FileToolServices) {
  return defineTool({
    name: 'delete_file',
    description: DELETE_FILE_PROMPTS.description,
    inputSchema: z.object({
      path: z.string().min(1).describe(DELETE_FILE_PROMPTS.path),
    }),
    execute: ({ input: { path: requested }, signal, context }) =>
      runFileTool({
        requested,
        signal,
        run: () => deleteFile({ services, requested, signal, context }),
      }),
  });
}

async function deleteFile(params: {
  services: FileToolServices;
  requested: string;
  signal: AbortSignal;
  context: ToolContext;
}) {
  const { services, requested, signal, context } = params;
  const { workspace, workingRoots, fileLocks, fileReads } = services;
  const agentId = agentOf(context);
  const root = await currentRoot(workingRoots);
  const real = await resolveDeletable({ workspace, requested, root });

  return fileLocks.run({
    file: real,
    signal,
    change: async () => {
      // Resolved before the lock to queue on the file, then again under it: a path swapped
      // while the delete waited would otherwise be read or removed without the guards.
      await assertSameDeletable({ workspace, requested, expected: real, root });

      if (!fileReads.hasRead({ agentId, file: real })) {
        throw new ToolCallError({
          reason: 'forbidden',
          message: `You have not read ${requested}. Read it with read_file first, so the delete is of what the file holds now.`,
        });
      }

      await assertReadableSize({ requested, file: real });

      const before = await readForChange({
        file: real,
        requested,
        signal,
        hint: 'It may already be deleted.',
      });

      assertReportedSize({ requested, content: before });

      // What the agent read is not what is there now, so the delete is not of what it saw.
      if (fileReads.forgetIfChanged({ agentId, file: real, hash: hashText(before) })) {
        throw new ToolCallError({
          reason: 'forbidden',
          message: `${requested} changed since you read it. Read it again with read_file, so the delete is of what the file holds now.`,
        });
      }

      // Node has no unlink-by-handle, so the unlink is a fresh path lookup after this check: a
      // parent swapped in that last moment is the one case neither check can close.
      await assertSameDeletable({ workspace, requested, expected: real, root });
      await removeFile({ file: real, signal });
      fileReads.markDeleted({ file: real });

      return changeResult({
        workspace,
        file: real,
        verb: 'Deleted',
        before,
        after: null,
        root,
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
