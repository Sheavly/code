import { z } from 'zod';

/** A skill's name: lowercase words joined by single dashes, as its folder is called. */
export const skillNameSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'name must be lowercase words joined by dashes');

/** Where a skill was found: the project's folders, the user's, or the ones the harness ships. */
export const skillScopeSchema = z.enum(['project', 'user', 'built-in']);

/** A skill as a UI lists it (a `/` menu): what it is called and for, never its body. */
export const skillInfoSchema = z.object({
  name: skillNameSchema,
  description: z.string(),
  /** Only the user runs it (`disable-model-invocation`); the model isn't offered it. */
  manualOnly: z.boolean(),
  scope: skillScopeSchema,
});
