import type { Model, ModelId } from '@sheavly/protocol/model/model.types';
import { profileIdSchema } from '@sheavly/protocol/profile/profile.validator';
import { ProfileRegistry } from '@sheavly/storage/profile-registry/profile-registry.service';

/** The id of the profile `setUpProfile` makes. */
export const TEST_PROFILE = profileIdSchema.parse('4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a30');

/**
 * Test-only: a user's folder (`home`) with one profile in it, the default, holding `models` that
 * each have the key `apiKey`, except those listed in `keyless`. `lastModelId` is the model the
 * profile last used. Returns the registry on that folder, to look at what the backend wrote.
 */
export async function setUpProfile(params: {
  home: string;
  models: Model[];
  apiKey?: string;
  keyless?: ModelId[];
  lastModelId?: ModelId;
}): Promise<ProfileRegistry> {
  const { home, models, apiKey = 'sk-test', keyless = [], lastModelId } = params;
  const registry = new ProfileRegistry({ root: home });

  await registry.put({ id: TEST_PROFILE, name: 'Work' });
  await registry.setDefaultProfile(TEST_PROFILE);

  const profile = await registry.open(TEST_PROFILE);

  for (const model of models) {
    await profile.putModel(model);

    if (!keyless.includes(model.id)) {
      await profile.putSecrets({ id: model.id, secrets: { apiKey } });
    }
  }

  if (lastModelId) await registry.rememberModel({ id: TEST_PROFILE, modelId: lastModelId });

  return registry;
}
