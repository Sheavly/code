import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Workspace } from '../../runtime/workspace/workspace.service.js';
import { defineTool } from '@sheavly/core/tool/tool.service';
import { MAX_READ_CHARS } from './read-file.constants.js';
import { assertNotEnvFile } from './read-file.utils.js';

/** Reads a UTF-8 text file inside the workspace. */
export function createReadFileTool({ workspace }: { workspace: Workspace }) {
  return defineTool({
    name: 'read_file',
    description:
      'Read a UTF-8 text file. Paths are relative to the workspace root. ' +
      'Files outside the workspace and .env files cannot be read.',
    inputSchema: z.object({
      path: z.string().min(1).describe('File path, relative to the workspace root'),
    }),
    execute: async ({ input: { path: requested }, signal }) => {
      assertNotEnvFile({ filePath: requested, requested }); // checked before touching the disk
      const real = await workspace.resolveRead(requested); // rejects escapes, follows symlinks

      assertNotEnvFile({ filePath: real, requested }); // a symlink pointing at a .env file

      const content = await readFile(real, { encoding: 'utf8', signal });

      return content.length > MAX_READ_CHARS
        ? `${content.slice(0, MAX_READ_CHARS)}\n\n[truncated: showing ${MAX_READ_CHARS} of ${content.length} characters]`
        : content;
    },
  });
}
