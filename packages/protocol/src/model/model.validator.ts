import { z } from 'zod';
import { lowercaseUuidSchema } from '../id/id.validator.js';

/**
 * A model's id: a UUID in lowercase, the stem of its file (`models/<id>.json`), and what a request,
 * a credential and the model switch call it by. Branded, so it can't be passed where another id
 * goes (see `lowercaseUuidSchema` for why that shape).
 */
export const modelIdSchema = lowercaseUuidSchema.brand<'ModelId'>();

/** Reasoning effort, independent of context size, output length and tool permissions. */
export const modelModeSchema = z.enum(['low', 'medium', 'high', 'extreme']);

export const modelSelectionSchema = z.object({ modelId: modelIdSchema, mode: modelModeSchema });

/** An adapter's kind (`openai`, `azure-openai`, `azure-anthropic`): lowercase words joined by dashes. */
export const adapterKindSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/, 'Use lowercase letters, digits and dashes, starting with a letter');

/** What a person sees of a model ("Astra 6"); free text. It is never sent to a provider. */
const modelNameSchema = z.string().trim().min(1).max(80);

/**
 * A model as its file holds it: everything about it but its secret, in the file itself, so the
 * file says what it is whatever it is called. Its `id` is its file's stem, its `name` is for
 * people only, `adapter` is what serves it, and the rest is that adapter's own fields, passed on
 * as they are (`GET /adapters` says what they are). What the provider itself calls the model is
 * one of those fields (`model`, `deployment`), apart from the name, which may be anything. Never a
 * secret: a key lives with the profile's credentials, not in a file that gets copied.
 */
export const modelFileSchema = z.looseObject({
  id: modelIdSchema,
  name: modelNameSchema,
  adapter: adapterKindSchema,
});

/** A model as the API lists it: its file read once. */
export const modelSchema = z.object({
  id: modelIdSchema,
  name: modelNameSchema,
  adapter: adapterKindSchema,
  /** The adapter's own fields, as the file holds them. */
  definition: z.record(z.string(), z.unknown()),
});

/** What `GET /adapters` says about one adapter, for a UI to build its form from. */
export const adapterDescriptionSchema = z.object({
  kind: adapterKindSchema,
  description: z.string(),
  /**
   * JSON Schema (draft 2020-12) of the fields a model of this adapter takes. A field a person must
   * keep secret carries `secret: true`; fields the backend fills in itself are left out.
   */
  config: z.record(z.string(), z.unknown()),
  /** The names of the secret fields: they go to the credentials, never into a model's file. */
  secrets: z.array(z.string()),
  /**
   * The name of the field that holds what the provider calls the model (`model` for OpenAI,
   * `deployment` for Azure), for an adapter that has one. A model's own `name` is only for people;
   * this is what is sent, so a UI can show both without knowing each adapter's vocabulary.
   */
  remoteField: z.string().min(1).exactOptional(),
});

/**
 * How a key check ended. `valid`: the model answered. `invalid`: the key was refused (401, 403).
 * `not_found`: the endpoint or deployment doesn't exist (404). `rejected`: the provider answered
 * but refused the request for another reason (a 400, rate limited, a failed reply).
 * `unreachable`: it couldn't be reached in time, or the provider itself failed. The message is
 * fixed text per status, never what the provider said, so a key can't come back in it.
 */
export const keyCheckSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('valid') }),
  z.object({
    status: z.enum(['invalid', 'not_found', 'rejected', 'unreachable']),
    message: z.string(),
  }),
]);
