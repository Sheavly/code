import type { AdapterDescription, Model } from '@sheavly/protocol/model/model.types';
import type { ModelOffering } from '@sheavly/protocol/setup/setup.types';
import { SetupError } from '../errors/setup.errors.js';
import { SETUP_HOSTING, SETUP_MODELS } from './model-catalog.constants.js';

/** Lists app suggestions with only the hosting routes this backend can actually serve. */
export function setupModelCatalog(adapters: AdapterDescription[]): ModelOffering[] {
  const available = new Set(adapters.map(({ kind }) => kind));

  return SETUP_MODELS.map((model) => ({
    ...model,
    identity: { ...model.identity },
    hosts: SETUP_HOSTING.filter(
      (host) => available.has(host.adapter) && host.families.includes(model.identity.family),
    ).map((host) => ({
      adapter: host.adapter,
      name: host.name,
      defaults: {
        ...host.defaults,
        ...(host.modelField === 'deployment' && { deployment: model.identity.model }),
      },
      fixed: host.modelField === 'model' ? { model: model.identity.model } : {},
    })),
  })).filter(({ hosts }) => hosts.length > 0);
}

/** Known identities cannot be paired with an incompatible host or a different native model. */
export function assertModelHosting(params: {
  model: Omit<Model, 'id'>;
  adapters: AdapterDescription[];
}): void {
  const { model, adapters } = params;
  const known = SETUP_MODELS.find((entry) => entry.identity.model === model.identity?.model);

  if (!known) return;

  if (model.identity?.family && model.identity.family !== known.identity.family) {
    throw new SetupError({
      reason: 'invalid',
      message: 'The selected model family does not match the catalogue.',
    });
  }

  const host = setupModelCatalog(adapters)
    .find((entry) => entry.identity.model === known.identity.model)
    ?.hosts.find((entry) => entry.adapter === model.adapter);

  if (!host) {
    throw new SetupError({
      reason: 'invalid',
      message: 'The selected hosting provider does not support this model.',
    });
  }

  for (const [field, value] of Object.entries(host.fixed)) {
    if (model.definition[field] !== value) {
      throw new SetupError({
        reason: 'invalid',
        message: `Use ${known.identity.model} for the provider model. Add a new model to choose a different one.`,
      });
    }
  }
}
