import { profileSchema } from '@sheavly/protocol/profile/profile.validator';
import { modelIdSchema } from '@sheavly/protocol/model/model.validator';

/** Legacy files migrate on read; the next profile write saves only the new representation. */
export const storedProfileSchema = profileSchema
  .extend({
    lastModelId: modelIdSchema.exactOptional(),
  })
  .transform(({ lastModelId, ...profile }) => {
    if (profile.lastModelSelection || !lastModelId) return profile;

    return {
      ...profile,
      lastModelSelection: { modelId: lastModelId, mode: 'medium' as const },
      modelModes: { ...profile.modelModes, [lastModelId]: 'medium' as const },
    };
  });
