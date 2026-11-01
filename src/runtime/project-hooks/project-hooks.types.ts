import type { z } from 'zod';
import type { hooksManifestSchema } from './project-hooks.utils.js';

/** `.sheavly/hooks.json`, after validation (`enabled` defaults to true). */
export type HooksManifest = z.infer<typeof hooksManifestSchema>;
