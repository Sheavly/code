import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Workspace } from '@sheavly/workspace/workspace/workspace.service';
import type { FileReads } from '@sheavly/workspace/file-reads/file-reads.service';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { MAX_READ_CHARS, MAX_READ_LINES } from './read-file.constants.js';
import { selectLines } from './read-file.utils.js';
import type { FileRead } from './read-file.types.js';
import { agentOf } from '../files/files.helper.js';
import { assertNotEnvFile, assertNotGitDir } from '../files/files.utils.js';
import { isInside } from '@sheavly/workspace/workspace/workspace.utils';

/**
 * Reads a UTF-8 text file inside the workspace: the whole file, or lines `startLine`–`endLine`,
 * at most `MAX_READ_LINES` per call. Limits fail open (what fits, plus a note on how to read the
 * rest); the guards don't: files outside the workspace and .env files are always refused.
 */
export function createReadFileTool({
  workspace,
  fileReads,
}: {
  workspace: Workspace;
  fileReads: FileReads;
}) {
  return defineTool({
    name: 'read_file',
    description:
      'Read a UTF-8 text file. Paths are relative to the workspace root. ' +
      `Returns at most ${MAX_READ_LINES} lines per call; use startLine and endLine (1-based, inclusive) ` +
      'to read a range. When a file is cut, a note at the end says which lines were shown and where to continue. ' +
      'Files outside the workspace and .env files cannot be read.',
    inputSchema: z.object({
      path: z.string().min(1).describe('File path, relative to the workspace root'),
      startLine: z.number().optional().describe('First line to read, 1-based (default 1)'),
      endLine: z
        .number()
        .optional()
        .describe(`Last line to read, inclusive (default: ${MAX_READ_LINES} lines from startLine)`),
    }),
    execute: async ({ input: { path: requested, startLine, endLine }, signal, context }) => {
      assertNotEnvFile({ filePath: requested, requested, action: 'Reading' }); // checked before touching the disk
      const real = await workspace.resolveRead(requested); // rejects escapes, follows symlinks

      assertNotEnvFile({ filePath: real, requested, action: 'Reading' }); // a symlink pointing at a .env file

      // A sibling worktree's .git (remote URLs, sometimes tokens) is as closed to reads as to writes.
      if (!isInside({ folder: workspace.root, target: real })) {
        assertNotGitDir({ relativePath: workspace.relative(real), requested, action: 'Reading' });
      }

      const text = await readFile(real, { encoding: 'utf8', signal });
      const { content, note, lines } = selectLines({
        text,
        startLine,
        endLine,
        maxLines: MAX_READ_LINES,
        maxChars: MAX_READ_CHARS,
      });

      // What the agent was shown, no more: `edit_file` takes the agent's word for those lines only.
      fileReads.markRead({
        agent: agentOf(context),
        file: real,
        text: content,
        whole: lines.whole,
      });

      const read: FileRead = {
        kind: 'file_read',
        path: workspace.relative(real),
        startLine: lines.start,
        endLine: lines.end,
        totalLines: lines.total,
        whole: lines.whole,
      };

      // For the UI: which lines this call covered, so it can say "read x" or "read x lines a–b".
      return { content: note ? `${content}\n${note}` : content, artifacts: [read] };
    },
  });
}
