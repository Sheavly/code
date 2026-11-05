import type { z } from 'zod';
import type { setupSchema } from './setup.validator.js';

/** What `GET /setup` answers. */
export type Setup = z.infer<typeof setupSchema>;
