import type { z } from 'zod';
import type { secretsSchema } from './credential-store.validator.js';

/** A model's secrets by field name, as the adapter names them. */
export type Secrets = z.infer<typeof secretsSchema>;
