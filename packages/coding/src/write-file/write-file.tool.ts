import { z } from 'zod';
import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import type { FileToolServices } from '../files/files.types.js';
import { createParentFolder, readIfExists, writeText } from '../files/file-effects.helper.js';
import { changeResult } from '../files/file-change.helper.js';
import { resolveWritable } from '../files/files.helper.js';
import { agentOf } from '../files/files.utils.js';

/**
 * Creates a new UTF-8 text file inside the workspace (creating parent folders), and refuses a
 * path that already holds a file: changing one is `edit_file`'s job, which makes the agent read
 * it first. The result carries the file's content, for a UI to show it as new.
 *
 * `fileLocks` orders changes to the same file, so two agents creating one path can't both win. It's
 * required, not defaulted: every writer of a file must share one instance (the harness's), and a
 * tool that made its own would silently let a parallel write or edit overlap. `fileReads` is the
 * harness's too: what the agent creates counts as seen, so it can edit it without reading it back.
 */
export function createWriteFileTool({ workspace, fileLocks, fileReads }: FileToolServices) {
  return defineTool({
    name: 'write_file',
    description:
      'Create a new file. Paths are relative to the workspace root; missing folders are ' +
      'created. It refuses a file that already exists: read it with read_file and change it ' +
      'with edit_file.',
    inputSchema: z.object({
      path: z.string().min(1).describe('File path, relative to the workspace root'),
      content: z.string().describe('The complete content of the new file'),
    }),
    execute: async ({ input: { path: requested, content }, signal, context }) => {
      const real = await resolveWritable({ workspace, requested });

      return fileLocks.run({
        file: real,
        signal,
        change: async () => {
          if ((await readIfExists({ file: real, signal })) !== null) {
            throw new ToolCallError({
              reason: 'invalid_input',
              message: `${requested} already exists. Read it with read_file and change it with edit_file; write_file only creates new files.`,
            });
          }

          await createParentFolder({ file: real });
          await writeText({ file: real, content, signal });
          fileReads.markRead({
            agent: agentOf(context),
            file: real,
            text: content,
            whole: true,
          });

          return changeResult({
            workspace,
            file: real,
            verb: 'Created',
            before: null,
            after: content,
          });
        },
      });
    },
  });
}
