import type { z } from 'zod';
import type { profileIdSchema, profileSchema } from './profile.validator.js';

/** A profile's id: a lowercase UUID, branded. */
export type ProfileId = z.infer<typeof profileIdSchema>;

/** A profile: its id, and the name a UI shows. */
export type Profile = z.infer<typeof profileSchema>;
