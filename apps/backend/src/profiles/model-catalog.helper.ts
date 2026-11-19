import type { AdapterDescription, Model } from '@sheavly/protocol/model/model.types';
import type { ModelOffering } from '@sheavly/protocol/setup/setup.types';
import { SetupError } from '../errors/setup.errors.js';
import { SETUP_HOSTING, SETUP_MODELS } from './model-catalog.constants.js';

/** Lists app suggestions with only the hosting routes this backend can actually serve. */
export function setupModelCatalog(adapters: AdapterDescription[]): ModelOffering[] {
  const available = new Set(adapters.map(({ kind }) => kind));

  return SETUP_MODELS.map((model) => ({
    name: model.name,
    identity: { ...model.identity },
    hosts: SETUP_HOSTING.filter(
      (host) => available.has(host.adapter) && host.families.includes(model.identity.family),
    ).map((host) => ({
      adapter: host.adapter,
      name: host.name,
      defaults: {
        ...host.defaults,
        ...model.hostingPresets?.[host.adapter],
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
  // Deployment names are matched case-insensitively, so a lowercase identity cannot slip past the
  // catalogue and pair a known model with a host it does not serve.
  const identity = model.identity?.model?.toLowerCase();
  const known = SETUP_MODELS.find((entry) => entry.identity.model.toLowerCase() === identity);

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

  assertProfileNamesModel({ model, known: known.identity.model });
}

/**
 * A Bedrock inference profile carries a prefix the user chooses, so it cannot be fixed, but it
 * must still be the catalogue model's own: `‹prefix›.‹owner›.‹model›`. Other hosts have no profile.
 */
function assertProfileNamesModel(params: { model: Omit<Model, 'id'>; known: string }): void {
  const { model, known } = params;
  const hosting = SETUP_HOSTING.find((entry) => entry.adapter === model.adapter);

  if (hosting?.modelField !== 'profile') return;

  const profile = model.definition.model;

  if (typeof profile === 'string' && isProfileOf({ profile, owner: hosting.profileOwner, known })) {
    return;
  }

  throw new SetupError({
    reason: 'invalid',
    message: `Use an inference profile for ${known}. Add a new model to choose a different one.`,
  });
}

/**
 * Whether `profile` is `‹prefix›.‹owner›.‹known›`, the prefix being any one the person chose and a
 * `:‹n›` version suffix allowed. The adapter judges the prefix; this only ties the profile to the
 * catalogue model, so another model's profile, or one with extra segments, is not accepted.
 */
function isProfileOf(params: { profile: string; owner: string; known: string }): boolean {
  const { profile, owner, known } = params;
  const [prefix, ...rest] = profile.toLowerCase().split('.');
  const tail = rest.join('.').replace(/:\d+$/, '');

  return Boolean(prefix) && tail === `${owner}.${known.toLowerCase()}`;
}
