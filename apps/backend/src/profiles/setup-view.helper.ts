import type { Model } from '@sheavly/protocol/model/model.types';
import type { Profile } from '@sheavly/protocol/profile/profile.types';
import type { Setup } from '@sheavly/protocol/setup/setup.types';
import { AdapterError } from '@sheavly/providers/errors/providers.errors';
import type { AdapterRegistry } from '@sheavly/providers/registry/registry.service';
import type { OpenProfile } from '@sheavly/storage/profile-registry/open-profile.service';
import { modelsOf } from './models.helper.js';
import type { RequestSettings } from './profiles.types.js';
import { credentialState, withoutSecrets } from './setup.utils.js';

type ProfileView = Setup['profiles'][number];
type ModelView = ProfileView['models'][number];

/**
 * The names of adapter `kind`'s secret fields, or `undefined` when this backend has no such
 * adapter (a model file may name one it lacks).
 */
export function secretsOf(params: {
  adapters: AdapterRegistry;
  kind: string;
}): string[] | undefined {
  try {
    return params.adapters.secretFields(params.kind);
  } catch (caughtError) {
    // Only an adapter the backend doesn't have is expected here; its absence is shown on the model.
    if (caughtError instanceof AdapterError && caughtError.reason === 'unknown') return undefined;
    throw caughtError;
  }
}

/** One model as a setup UI shows it; `usable` is whether `modelsOf` built it into a provider. */
function modelView(params: {
  model: Model;
  adapters: AdapterRegistry;
  set: readonly string[];
  usable: boolean;
}): ModelView {
  const { model, adapters, set, usable } = params;
  const required = secretsOf({ adapters, kind: model.adapter });

  return {
    ...model,
    definition: withoutSecrets({ definition: model.definition, secrets: required ?? [] }),
    credential: credentialState({ required, set }),
    usable,
  };
}

/**
 * Profile `profile` with its models and, for each, whether its key is set and whether a conversation
 * can run on it, judged by the same `modelsOf` that starts one, so this never says "usable" for a
 * model a conversation would skip. `problems` is what its models folder could not read.
 */
export async function profileView(params: {
  profile: Profile;
  open: OpenProfile;
  adapters: AdapterRegistry;
  request: RequestSettings;
}): Promise<{ view: ProfileView; problems: string[] }> {
  const { profile, open, adapters, request } = params;
  const listing = await open.listModels();
  const secrets = await open.secretFields();
  const { models: built } = await modelsOf({ profile: open, registry: adapters, request });
  const usable = new Set(built.choices.map((choice) => choice.id));
  const models = listing.models.map((model) =>
    modelView({ model, adapters, set: secrets[model.id] ?? [], usable: usable.has(model.id) }),
  );

  return {
    view: { ...profile, models, ready: models.some((model) => model.usable) },
    problems: listing.problems.map((problem) => `${problem.file}: ${problem.message}`),
  };
}
