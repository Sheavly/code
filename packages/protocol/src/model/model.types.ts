import type { z } from 'zod';
import type {
  adapterDescriptionSchema,
  contextWindowSizeSchema,
  keyCheckSchema,
  modelFileSchema,
  modelIdSchema,
  modelSchema,
  modelModeSchema,
  modelSelectionSchema,
  modelIdentitySchema,
} from './model.validator.js';

/** A model's id: a lowercase UUID, which names the model wherever one is picked or switched to. */
export type ModelId = z.infer<typeof modelIdSchema>;

export type ModelMode = z.infer<typeof modelModeSchema>;
export type ModelSelection = z.infer<typeof modelSelectionSchema>;
export type ModelIdentity = z.infer<typeof modelIdentitySchema>;

/** A context size a model can be set to: one of `CONTEXT_WINDOW_SIZES`. */
export type ContextWindowSize = z.infer<typeof contextWindowSizeSchema>;

/** A model as its file holds it. */
export type ModelFile = z.infer<typeof modelFileSchema>;

/** A model as the API lists it. */
export type Model = z.infer<typeof modelSchema>;

/** What `GET /adapters` says about one adapter. */
export type AdapterDescription = z.infer<typeof adapterDescriptionSchema>;

/** How a key check ended. */
export type KeyCheck = z.infer<typeof keyCheckSchema>;
