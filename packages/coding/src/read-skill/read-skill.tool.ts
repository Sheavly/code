import { z } from 'zod';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import { readSkillFile } from '@sheavly/workspace/skills/skill-files.helper';
import type { SkillRoots } from '@sheavly/workspace/skills/skills.types';
import { assertNotEnvFile } from '../files/files.utils.js';
import { READ_SKILL_PROMPTS } from './read-skill.prompt.js';

/**
 * Reads a skill by name: its SKILL.md, or a file in its folder that it links to. Skills live in
 * the project's and the user's skill folders, so this reads outside the workspace, but only inside
 * a skill's own folder (symlinks followed), and never a .env file. Returns the complete file.
 */
export function createReadSkillTool(roots: SkillRoots) {
  return defineTool({
    name: 'read_skill',
    description: READ_SKILL_PROMPTS.description,
    inputSchema: z.object({
      name: z.string().min(1).describe(READ_SKILL_PROMPTS.name),
      file: z.string().min(1).optional().describe(READ_SKILL_PROMPTS.file),
    }),
    execute: async ({ input: { name, file }, signal }) => {
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

      return found.text;
    },
  });
}
