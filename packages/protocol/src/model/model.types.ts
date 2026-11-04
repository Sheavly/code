import type { z } from 'zod';
import type {
  adapterDescriptionSchema,
  keyCheckSchema,
  modelFileSchema,
  modelIdSchema,
  modelSchema,
} from './model.validator.js';

/** A model's id: a lowercase UUID, which names the model wherever one is picked or switched to. */
export type ModelId = z.infer<typeof modelIdSchema>;

/** A model as its file holds it. */
export type ModelFile = z.infer<typeof modelFileSchema>;

/** A model as the API lists it. */
export type Model = z.infer<typeof modelSchema>;

/** What `GET /adapters` says about one adapter. */
export type AdapterDescription = z.infer<typeof adapterDescriptionSchema>;

/** How a key check ended. */
export type KeyCheck = z.infer<typeof keyCheckSchema>;
