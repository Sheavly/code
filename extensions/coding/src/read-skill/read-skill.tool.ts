import { z } from 'zod';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import type { FileReads } from '@sheavly/workspace/file-reads/file-reads.service';
import { hashText } from '@sheavly/workspace/file-reads/file-reads.utils';
import { agentOf, assertNotEnvFile } from '../files/files.utils.js';
import { readSkillFile } from '../skills/skill-files.helper.js';
import type { SkillRoots } from '../skills/skills.types.js';
import { READ_SKILL_PROMPTS } from './read-skill.prompt.js';

/**
 * Reads a skill by name: its SKILL.md, or a file in its folder that it links to. Skills live in
 * the project's and the user's skill folders, so this reads outside the workspace, but only inside
 * a skill's own folder (symlinks followed), and never a .env file. Returns the complete file.
 *
 * What it returns counts as read, as `read_file`'s does, so `edit_file` can change a project skill
 * the agent read here. `fileReads` is the harness's, shared with the file tools. The read is
 * recorded outside the file's lock: the hash is of the text returned, so a file changed since is
 * forgotten by the next edit, which then asks for a new read.
 */
export function createReadSkillTool(params: { roots: SkillRoots; fileReads: FileReads }) {
  const { roots, fileReads } = params;

  return defineTool({
    name: 'read_skill',
    description: READ_SKILL_PROMPTS.description,
    inputSchema: z.object({
      name: z.string().min(1).describe(READ_SKILL_PROMPTS.name),
      file: z.string().min(1).optional().describe(READ_SKILL_PROMPTS.file),
    }),
    execute: async ({ input: { name, file }, signal, context }) => {
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

      fileReads.markRead({
        agentId: agentOf(context),
        file: found.path,
        text: found.text,
        whole: true,
        hash: hashText(found.text),
      });

      return found.text;
    },
  });
}
