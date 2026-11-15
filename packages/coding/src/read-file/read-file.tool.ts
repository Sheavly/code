import { z } from 'zod';
import { currentRoot, displayPath } from '../files/working-root.helper.js';
import { assertSameReadable, resolveReadable } from '../files/files.helper.js';
import type { FileToolServices } from '../files/files.types.js';
import type { ToolContext } from '@sheavly/core/tool/tool.types';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { runFileTool } from '../files/file-tool.helper.js';
import { MAX_READ_CHARS, MAX_READ_LINES } from './read-file.constants.js';
import { streamLines } from './read-file.helper.js';
import { selectLinesFrom } from './read-file.utils.js';
import { READ_FILE_PROMPTS } from './read-file.prompt.js';
import type { FileRead } from './read-file.types.js';
import { agentOf } from '../files/files.utils.js';

/**
 * Reads a UTF-8 text file inside the workspace: the whole file, or lines `startLine`–`endLine`,
 * at most `MAX_READ_LINES` per call. Limits fail open (what fits, plus a note on how to read the
 * rest); the guards don't: files outside the workspace and .env files are always refused.
 */
export function createReadFileTool(services: FileToolServices) {
  return defineTool({
    name: 'read_file',
    description: READ_FILE_PROMPTS.description,
    inputSchema: z.object({
      path: z.string().min(1).describe(READ_FILE_PROMPTS.path),
      startLine: z.number().optional().describe(READ_FILE_PROMPTS.startLine),
      endLine: z.number().optional().describe(READ_FILE_PROMPTS.endLine),
    }),
    execute: ({ input, signal, context }) =>
      runFileTool({
        requested: input.path,
        signal,
        run: () => readFileTool({ services, input, signal, context }),
      }),
  });
}

async function readFileTool(params: {
  services: FileToolServices;
  input: { path: string; startLine?: number | undefined; endLine?: number | undefined };
  signal: AbortSignal;
  context: ToolContext;
}) {
  const { services, input, signal, context } = params;
  const { workspace, workingRoots, fileLocks, fileReads } = services;
  const { path: requested, startLine, endLine } = input;
  const root = await currentRoot(workingRoots);
  const real = await resolveReadable({ workspace, requested, root });

  // Under the file's lock, so a read never sees a half-written file, and so the read is recorded
  // before any edit queued behind it can run: a later record of an older hash would undo it. One
  // pass: only the lines to show are kept, however big the file is.
  const { content, note, lines } = await fileLocks.run({
    file: real,
    signal,
    change: async () => {
      await assertSameReadable({ workspace, requested, expected: real, root });

      const streamed = await streamLines({
        file: real,
        requested,
        startLine,
        maxLines: MAX_READ_LINES,
        maxChars: MAX_READ_CHARS,
        signal,
      });
      const selected = selectLinesFrom({
        ...streamed,
        startLine,
        endLine,
        maxLines: MAX_READ_LINES,
        maxChars: MAX_READ_CHARS,
      });

      // What the agent was shown, no more: `edit_file` takes the agent's word for those lines only.
      fileReads.markRead({
        agentId: agentOf(context),
        file: real,
        text: selected.content,
        whole: selected.lines.whole,
        hash: streamed.hash,
      });

      return selected;
    },
  });

  const read: FileRead = {
    kind: 'file_read',
    path: displayPath({ workspace, root, absolute: real }),
    startLine: lines.start,
    endLine: lines.end,
    totalLines: lines.total,
    whole: lines.whole,
  };

  // For the UI: which lines this call covered, so it can say "read x" or "read x lines a–b".
  return { content: note ? `${content}\n${note}` : content, artifacts: [read] };
}
