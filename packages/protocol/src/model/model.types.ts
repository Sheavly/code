import type { z } from 'zod';
import type { modelFileSchema, modelSchema } from './model.validator.js';

/** A model as its file holds it. */
export type ModelFile = z.infer<typeof modelFileSchema>;

/** A model as the API lists it. */
export type Model = z.infer<typeof modelSchema>;
