import { z } from 'zod';
import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import type { ToolContext } from '@sheavly/core/tool/tool.types';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import type { FileToolServices } from '../files/files.types.js';
import { runFileTool } from '../files/file-tool.helper.js';
import {
  assertContentFits,
  assertFitsInMemory,
  readForChange,
  writeText,
} from '../files/file-effects.helper.js';
import { changeResult } from '../files/file-change.helper.js';
import { resolveWritable } from '../files/files.helper.js';
import { agentOf } from '../files/files.utils.js';
import { currentRoot } from '../files/working-root.helper.js';
import { applyEdit } from './edit-file.utils.js';
import { EDIT_FILE_PROMPTS } from './edit-file.prompt.js';

/**
 * Replaces an exact piece of text in an existing file. The text must occur exactly once (or
 * set `replaceAll`), so an ambiguous edit is refused instead of changing the wrong place. The
 * calling agent must have read the file (`read_file`) or made it: an edit from memory is refused.
 * The result carries the file's before/after content, for a UI to show the diff.
 *
 * `fileLocks` orders changes to the same file. It's required, not defaulted: every writer of a
 * file must share one instance (the harness's), and a tool that made its own would silently let
 * a parallel write or edit overlap. `fileReads` is the harness's too, for the same reason.
 */
export function createEditFileTool(services: FileToolServices) {
  return defineTool({
    name: 'edit_file',
    description: EDIT_FILE_PROMPTS.description,
    inputSchema: z.object({
      path: z.string().min(1).describe(EDIT_FILE_PROMPTS.path),
      oldText: z.string().min(1).describe(EDIT_FILE_PROMPTS.oldText),
      newText: z.string().describe(EDIT_FILE_PROMPTS.newText),
      replaceAll: z.boolean().optional().describe(EDIT_FILE_PROMPTS.replaceAll),
    }),
    execute: ({ input, signal, context }) =>
      runFileTool({
        requested: input.path,
        signal,
        run: () => editFile({ services, input, signal, context }),
      }),
  });
}

async function editFile(params: {
  services: FileToolServices;
  input: { path: string; oldText: string; newText: string; replaceAll?: boolean | undefined };
  signal: AbortSignal;
  context: ToolContext;
}) {
  const { services, input, signal, context } = params;
  const { workspace, workingRoots, fileLocks, fileReads } = services;
  const { path: requested, oldText, newText, replaceAll = false } = input;
  const root = await currentRoot(workingRoots);
  const real = await resolveWritable({ workspace, requested, root });
  const agent = agentOf(context);

  return fileLocks.run({
    file: real,
    signal,
    change: async () => {
      await assertFitsInMemory({
        file: real,
        requested,
        hint: 'Change it with run_command (sed) instead.',
      });

      const before = await readForChange({
        file: real,
        requested,
        signal,
        hint: 'Use write_file to create it.',
      });

      if (!fileReads.hasRead({ agent, file: real })) {
        throw new ToolCallError({
          reason: 'forbidden',
          message: `You have not read ${requested}. Read it with read_file first, so the edit is made from what the file holds now.`,
        });
      }

      // Every occurrence changes, including ones in lines the agent was never shown.
      if (replaceAll && !fileReads.hasReadWhole({ agent, file: real })) {
        throw new ToolCallError({
          reason: 'forbidden',
          message: `replaceAll changes every occurrence in ${requested}, so read all of it first: call read_file without startLine and endLine.`,
        });
      }

      const { after, count } = applyEdit({ before, oldText, newText, replaceAll, requested });

      assertContentFits({ content: after, requested });

      // A file read in part is edited in the parts that were read. The text exists once in the
      // file (or replaceAll was checked above), so if it is in what was shown, that is the place.
      if (!fileReads.hasSeen({ agent, file: real, text: oldText })) {
        throw new ToolCallError({
          reason: 'forbidden',
          message: `The text you are replacing is not in what you have read of ${requested}. Read the lines you are changing with read_file (startLine and endLine; in one call if the text spans several lines), then edit.`,
        });
      }

      await writeText({ file: real, content: after, signal });
      // What the agent saw now holds the new text, so it can edit that place again unread.
      fileReads.markEdited({ agent, file: real, oldText, newText, replaceAll });

      const replaced = count > 1 ? `, ${count} replacements` : '';

      return changeResult({
        workspace,
        file: real,
        verb: 'Edited',
        before,
        after,
        suffix: replaced,
        root,
      });
    },
  });
}
