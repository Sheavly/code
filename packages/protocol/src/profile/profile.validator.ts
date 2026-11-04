import { z } from 'zod';
import { lowercaseUuidSchema } from '../id/id.validator.js';

/**
 * A profile's id: a UUID in lowercase, the name of its folder (`profiles/<id>/`) and what a request
 * and the config call it by. Branded, so a model's id can't be passed where it goes. The name a
 * person gave it ("work") is inside, as a label.
 */
export const profileIdSchema = lowercaseUuidSchema.brand<'ProfileId'>();

/**
 * A profile as its `profile.json` holds it, and as a UI lists it: a bundle of the models,
 * credentials and conversations that differ between, say, work and personal use. The `name` is for
 * people only; nothing is keyed by it, so two profiles may share one.
 */
export const profileSchema = z.object({
  id: profileIdSchema,
  name: z.string().trim().min(1).max(80),
});
