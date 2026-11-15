import { defineTool } from '@sheavly/core/tool/tool.utils';
import { errorCode } from '@sheavly/runtime/errors/errors.utils';
import { z } from 'zod';
import type { ToolContext } from '@sheavly/core/tool/tool.types';
import { hashText } from '@sheavly/workspace/file-reads/file-reads.utils';
import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import { runFileTool } from '../files/file-tool.helper.js';
import type { FileToolServices } from '../files/files.types.js';
import { assertContentFits, createParentFolder, writeText } from '../files/file-effects.helper.js';
import { changeResult } from '../files/file-change.helper.js';
import { assertSameWritable, resolveWritable } from '../files/files.helper.js';
import { agentOf } from '../files/files.utils.js';
import { currentRoot } from '../files/working-root.helper.js';
import { WRITE_FILE_PROMPTS } from './write-file.prompt.js';

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
export function createWriteFileTool(services: FileToolServices) {
  return defineTool({
    name: 'write_file',
    description: WRITE_FILE_PROMPTS.description,
    inputSchema: z.object({
      path: z.string().min(1).describe(WRITE_FILE_PROMPTS.path),
      content: z.string().describe(WRITE_FILE_PROMPTS.content),
    }),
    execute: ({ input: { path: requested, content }, signal, context }) =>
      runFileTool({
        requested,
        signal,
        run: () => writeFile({ services, requested, content, signal, context }),
      }),
  });
}

async function writeFile(params: {
  services: FileToolServices;
  requested: string;
  content: string;
  signal: AbortSignal;
  context: ToolContext;
}) {
  const { services, requested, content, signal, context } = params;
  const { workspace, workingRoots, fileLocks, fileReads } = services;

  assertContentFits({ content, requested });
  const root = await currentRoot(workingRoots);
  const real = await resolveWritable({ workspace, requested, root });

  return fileLocks.run({
    file: real,
    signal,
    change: async () => {
      await assertSameWritable({ workspace, requested, expected: real, root });

      await createParentFolder({ file: real });

      // Exclusive: an existing path, or a symlink put there since the guard, is refused, never
      // written through.
      try {
        await writeText({ file: real, content, signal, create: true });
      } catch (caughtError) {
        // EEXIST is the one failure expected here: something is already at the path.
        if (errorCode(caughtError) !== 'EEXIST') throw caughtError;

        throw new ToolCallError({
          reason: 'invalid_input',
          message: `${requested} already exists. Read it with read_file and change it with edit_file; write_file only creates new files.`,
        });
      }

      fileReads.markRead({
        agent: agentOf(context),
        file: real,
        text: content,
        whole: true,
        hash: hashText(content),
      });

      return changeResult({
        workspace,
        file: real,
        verb: 'Created',
        before: null,
        after: content,
        root,
      });
    },
  });
}
