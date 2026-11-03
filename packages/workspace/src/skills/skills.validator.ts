import { z } from 'zod';
import { skillNameSchema } from '@sheavly/protocol/skill/skill.validator';

/**
 * A skill's frontmatter: the same fields Cursor, Claude and Codex read, so existing skills work.
 * `name` is the folder's name; `disable-model-invocation` keeps the skill out of the model's list,
 * for skills only the user runs (`/<name>`).
 */
export const skillFrontmatterSchema = z.looseObject({
  name: skillNameSchema,
  description: z.string().min(1, 'description is empty'),
  'disable-model-invocation': z.boolean().optional(),
});
