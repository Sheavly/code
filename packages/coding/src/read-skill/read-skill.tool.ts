import { z } from 'zod';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import { readSkillFile } from '@sheavly/workspace/skills/skill-files.helper';
import type { SkillRoots } from '@sheavly/workspace/skills/skills.types';
import { MAX_READ_CHARS, MAX_READ_LINES } from '../read-file/read-file.constants.js';
import { selectLines } from '../read-file/read-file.utils.js';
import { assertNotEnvFile } from '../files/files.utils.js';

/**
 * Reads a skill by name: its SKILL.md, or a file in its folder that it links to. Skills live in
 * the project's and the user's skill folders, so this reads outside the workspace, but only inside
 * a skill's own folder (symlinks followed), and never a .env file. Same limits as read_file.
 */
export function createReadSkillTool(roots: SkillRoots) {
  return defineTool({
    name: 'read_skill',
    description:
      'Read a skill from the skills list: its SKILL.md (the default), or a file in its folder ' +
      'that SKILL.md links to, by its path relative to the folder. ' +
      `Returns at most ${MAX_READ_LINES} lines per call; use startLine to read on.`,
    inputSchema: z.object({
      name: z.string().min(1).describe('The skill’s name, as in the skills list'),
      file: z
        .string()
        .min(1)
        .optional()
        .describe('A file in the skill’s folder, relative to it (default SKILL.md)'),
      startLine: z.number().optional().describe('First line to read, 1-based (default 1)'),
    }),
    execute: async ({ input: { name, file, startLine }, signal }) => {
      const requested = file ?? 'SKILL.md';

      assertNotEnvFile({ filePath: requested, requested, action: 'Reading' });

      const found = await readSkillFile({ ...roots, name, file, signal });

      if (!found) {
        throw new ToolCallError({
          reason: 'not_found',
          message: `No skill is called ${name}. Use a name from the skills list.`,
        });
      }

      assertNotEnvFile({ filePath: found.path, requested, action: 'Reading' }); // a symlink to one

      const { content, note } = selectLines({
        text: found.text,
        startLine,
        maxLines: MAX_READ_LINES,
        maxChars: MAX_READ_CHARS,
        tool: 'read_skill',
      });

      return note ? `${content}\n${note}` : content;
    },
  });
}
