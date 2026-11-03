import type { z } from 'zod';
import type { skillInfoSchema, skillScopeSchema } from './skill.validator.js';

export type SkillScope = z.infer<typeof skillScopeSchema>;

/** A skill as a UI lists it: name, description, whether only the user runs it, and its scope. */
export type SkillInfo = z.infer<typeof skillInfoSchema>;
