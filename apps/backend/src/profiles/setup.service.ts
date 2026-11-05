import type { AdapterDescription, KeyCheck } from '@sheavly/protocol/model/model.types';
import type { ModelId } from '@sheavly/protocol/model/model.types';
import type { ProfileId } from '@sheavly/protocol/profile/profile.types';
import type { Setup } from '@sheavly/protocol/setup/setup.types';
import { AdapterError } from '@sheavly/providers/errors/providers.errors';
import type { AdapterRegistry } from '@sheavly/providers/registry/registry.service';
import { RegistryError } from '@sheavly/storage/errors/registry.errors';
import type { ProfileRegistry } from '@sheavly/storage/profile-registry/profile-registry.service';
import { SetupError } from '../errors/setup.errors.js';
import type { RequestSettings } from './profiles.types.js';
import { matchesModel } from './setup.utils.js';
import { profileView, secretsOf } from './setup-view.helper.js';

type ProfileView = Setup['profiles'][number];
type ModelView = ProfileView['models'][number];

/** `fn`, with the registry's "no such profile or model" turned into the setup's `not_found`. */
async function orNotFound<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (caughtError) {
    // Only a profile or model that isn't there is the caller's mistake; the rest is not ours to hide.
    if (!(caughtError instanceof RegistryError)) throw caughtError;
    throw new SetupError({ reason: 'not_found', message: caughtError.message, cause: caughtError });
  }
}

/**
 * What a setup UI does to the user's profiles: look at them (`setup`, `profile`, `models`), make
 * and change them, and set a model's key. It shares `Profiles`' registry, so a change shows in the
 * next conversation, and it is the only way a key gets into the backend: write-only, and never
 * in an answer, a message or a log. `remoteSetupAllowed` is false when the backend listens
 * beyond this machine, where a key (or a grant of trust) must not travel.
 */
export class ProfileSetup {
  readonly #registry: ProfileRegistry;
  readonly #adapters: AdapterRegistry;
  readonly #home: string;
  readonly #request: RequestSettings;
  readonly #remoteSetupAllowed: boolean;

  constructor(params: {
    registry: ProfileRegistry;
    adapters: AdapterRegistry;
    home: string;
    request: RequestSettings;
    remoteSetupAllowed: boolean;
  }) {
    this.#registry = params.registry;
    this.#adapters = params.adapters;
    this.#home = params.home;
    this.#request = params.request;
    this.#remoteSetupAllowed = params.remoteSetupAllowed;
  }

  /** What each adapter needs, for the form that adds a model. */
  adapters(): AdapterDescription[] {
    return this.#adapters.describe();
  }

  /** The user's folder, the profiles with their models, and the default; see `Setup`. */
  async setup(): Promise<Setup> {
    const listing = await this.#registry.list();
    const { defaultProfile } = await this.#registry.config();
    const views: ProfileView[] = [];
    const problems = listing.problems.map((problem) => `${problem.file}: ${problem.message}`);

    for (const profile of listing.profiles) {
      const { view, problems: found } = await this.#view(profile.id);

      views.push(view);
      problems.push(...found);
    }

    // A default naming a profile that is gone counts as none, as it does when a conversation starts.
    const named = views.some((view) => view.id === defaultProfile);

    return {
      home: this.#home,
      ...(defaultProfile && named && { defaultProfile }),
      profiles: views,
      problems,
    };
  }

  /** Profile `id` with its models. `not_found` when there is none. */
  async profile(id: ProfileId): Promise<ProfileView> {
    return (await this.#view(id)).view;
  }

  /** A profile's models, or those whose name, adapter or provider-side model has `search`. */
  async models(params: { profile: ProfileId; search?: string | undefined }): Promise<ModelView[]> {
    const { profile, search } = params;
    const { models } = await this.profile(profile);

    if (!search) return models;

    const remoteFields = new Map(this.#adapters.describe().map((a) => [a.kind, a.remoteField]));

    return models.filter((model) =>
      matchesModel({ model, remoteField: remoteFields.get(model.adapter), search }),
    );
  }

  /** One model of a profile. `not_found` when the profile or the model isn't there. */
  async model(params: { profile: ProfileId; model: ModelId }): Promise<ModelView> {
    const found = (await this.profile(params.profile)).models.find((m) => m.id === params.model);

    if (!found) throw notFound(`Profile ${params.profile} has no model ${params.model}`);

    return found;
  }

  /** Makes a profile under `id`, or renames it. Does not make it the default. */
  async putProfile(params: { id: ProfileId; name: string }): Promise<void> {
    await this.#registry.put(params);
  }

  /** Deletes a profile with its models, keys and conversations; none is fine. */
  async deleteProfile(id: ProfileId): Promise<void> {
    await this.#registry.delete(id);
  }

  /** Makes profile `id` the default. `not_found` when there is none. */
  async setDefaultProfile(id: ProfileId): Promise<void> {
    await orNotFound(() => this.#registry.setDefaultProfile(id));
  }

  /**
   * Stores a model under `id`, replacing the one with that id and keeping its key. Its adapter
   * checks the definition first, so a model it would reject is never stored; `invalid` says why.
   */
  async putModel(params: {
    profile: ProfileId;
    id: ModelId;
    model: { name: string; adapter: string; definition: Record<string, unknown> };
  }): Promise<void> {
    const { profile, id, model } = params;
    const open = await orNotFound(() => this.#registry.open(profile));

    this.#assertDefinition(model);
    await open.putModel({ id, ...model });
  }

  /** Removes a model and its key; none is fine. */
  async deleteModel(params: { profile: ProfileId; model: ModelId }): Promise<void> {
    const open = await orNotFound(() => this.#registry.open(params.profile));

    await open.removeModel(params.model);
  }

  /**
   * Sets a model's secrets, replacing the ones it had. `forbidden` unless this backend may take
   * keys; `invalid` for a field its adapter doesn't have.
   */
  async putCredential(params: {
    profile: ProfileId;
    model: ModelId;
    secrets: Record<string, string>;
  }): Promise<void> {
    const { profile, model, secrets } = params;

    this.#assertRemoteSetupAllowed();

    const { open, stored } = await this.#modelOf({ profile, model });
    const takes = secretsOf({ adapters: this.#adapters, kind: stored.adapter }) ?? [];
    const extra = Object.keys(secrets).filter((field) => !takes.includes(field));

    if (extra.length > 0) {
      throw new SetupError({
        reason: 'invalid',
        message: `The adapter ${stored.adapter} takes only these secrets: ${takes.length > 0 ? takes.join(', ') : 'none'}`,
      });
    }

    await open.putSecrets({ id: model, secrets });
  }

  /** Forgets a model's secrets and keeps the model. `forbidden` as `putCredential`. */
  async deleteCredential(params: { profile: ProfileId; model: ModelId }): Promise<void> {
    this.#assertRemoteSetupAllowed();

    const open = await orNotFound(() => this.#registry.open(params.profile));

    await open.removeSecrets(params.model);
  }

  /**
   * Tries a model with its stored key: one tiny call through its adapter. The answer is a fixed
   * message per status, never what the provider said. `forbidden` as `putCredential`: the key
   * leaves for the model's endpoint. `invalid` for a model that can't be tried at all (its adapter
   * is unknown or its definition or key missing).
   */
  async checkCredential(params: {
    profile: ProfileId;
    model: ModelId;
    signal?: AbortSignal | undefined;
  }): Promise<KeyCheck> {
    const { profile, model, signal } = params;

    this.#assertRemoteSetupAllowed();

    const { open, stored } = await this.#modelOf({ profile, model });
    const secrets = await open.getSecrets(model);

    try {
      return await this.#adapters.check({
        kind: stored.adapter,
        config: { ...stored.definition, ...secrets },
        signal,
      });
    } catch (caughtError) {
      // An adapter that can't be built from what is stored is the caller's to fix; the rest is ours.
      if (!(caughtError instanceof AdapterError)) throw caughtError;
      throw new SetupError({
        reason: 'invalid',
        message: `Model ${model} cannot be tried: its adapter, definition or key is not usable. Set its key and check its fields.`,
        cause: caughtError,
      });
    }
  }

  /** Profile `profile` opened, and its model `model`; `not_found` when either isn't there. */
  async #modelOf(params: { profile: ProfileId; model: ModelId }) {
    const { profile, model } = params;
    const open = await orNotFound(() => this.#registry.open(profile));
    const stored = await open.getModel(model);

    if (!stored) throw notFound(`Profile ${profile} has no model ${model}`);

    return { open, stored };
  }

  async #view(id: ProfileId) {
    const profile = await this.#registry.get(id);

    if (!profile) throw notFound(`No profile ${id}`);

    const open = await orNotFound(() => this.#registry.open(id));

    return profileView({ profile, open, adapters: this.#adapters, request: this.#request });
  }

  #assertDefinition(model: { adapter: string; definition: Record<string, unknown> }): void {
    const problems = this.#problemsOf(model);

    if (problems.length === 0) return;
    throw new SetupError({
      reason: 'invalid',
      message: problems.map((problem) => `${problem.field}: ${problem.message}`).join('; '),
    });
  }

  #problemsOf(model: { adapter: string; definition: Record<string, unknown> }) {
    try {
      return this.#adapters.validateDefinition({
        kind: model.adapter,
        definition: model.definition,
        host: { request: this.#request },
      });
    } catch (caughtError) {
      // An adapter this backend doesn't have is the caller's to fix; anything else is not ours to hide.
      if (!(caughtError instanceof AdapterError)) throw caughtError;
      throw new SetupError({ reason: 'invalid', message: caughtError.message, cause: caughtError });
    }
  }

  #assertRemoteSetupAllowed(): void {
    if (this.#remoteSetupAllowed) return;
    throw new SetupError({
      reason: 'forbidden',
      message:
        'This backend listens beyond this machine, so it takes no keys and grants no trust. Listen on 127.0.0.1, or set SERVER_ALLOW_REMOTE_SETUP=true behind TLS.',
    });
  }
}

function notFound(message: string): SetupError {
  return new SetupError({ reason: 'not_found', message });
}
