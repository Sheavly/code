import type { z } from 'zod';
import type { profileIdSchema } from './profile.validator.js';

/** A profile's id: a lowercase UUID, branded. */
export type ProfileId = z.infer<typeof profileIdSchema>;
