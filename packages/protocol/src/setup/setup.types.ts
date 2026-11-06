import type { z } from 'zod';
import type { profileSetupSchema, setupSchema } from './setup.validator.js';

/** What `GET /setup` answers. */
export type Setup = z.infer<typeof setupSchema>;

export type ProfileSetup = z.infer<typeof profileSetupSchema>;
