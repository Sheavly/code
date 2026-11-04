import type { Model, ModelId } from '@sheavly/protocol/model/model.types';
import type { ProfileId } from '@sheavly/protocol/profile/profile.types';
import { CredentialStore } from '../credential-store/credential-store.service.js';
import type { Secrets } from '../credential-store/credential-store.types.js';
import { RegistryError } from '../errors/registry.errors.js';
import { ModelStore } from '../model-store/model-store.service.js';
import type { ModelListing } from '../model-store/model-store.types.js';
import type { ProfileStore } from '../profile-store/profile-store.service.js';
import { requireProfile } from './profile-registry.helper.js';

/**
 * One profile opened for use: its models and its keys, held together so they can't drift apart.
 * Get it from `ProfileRegistry.open`, which hands out one per profile (the credential store queues
 * its writes in memory, so a second one on the same file would not know of the first's).
 *
 * - A model is removed with its key: the key goes first, so a failure leaves a model without a key
 *   (set it again) and never a key for a model that no longer exists.
 * - A key can only be set for a model that exists.
 * - Every write first checks the profile still exists, so a profile deleted in the meantime is not
 *   quietly recreated as a folder holding one key. A delete that lands between that check and the
 *   write can still leave such a folder; the listing reports it, and deleting the profile clears it.
 */
export class OpenProfile {
  readonly id: ProfileId;
  readonly #profiles: ProfileStore;
  readonly #models: ModelStore;
  readonly #credentials: CredentialStore;

  constructor(params: { id: ProfileId; profiles: ProfileStore }) {
    const { id, profiles } = params;
    const folder = profiles.folderOf(id);

    this.id = id;
    this.#profiles = profiles;
    this.#models = new ModelStore({ folder });
    this.#credentials = new CredentialStore({ folder });
  }

  /** The profile's models, and a problem for each file that isn't one (see `ModelStore.list`). */
  async listModels(): Promise<ModelListing> {
    return this.#models.list();
  }

  /** The model with this id, or `undefined`. */
  async getModel(id: ModelId): Promise<Model | undefined> {
    return this.#models.get(id);
  }

  /**
   * Stores `model`, replacing the one with its id. Its definition must already be checked and hold
   * no secret (`AdapterRegistry.validateDefinition`); the model's key is set apart, by `putSecrets`.
   */
  async putModel(model: Model): Promise<void> {
    await this.#assertProfile();
    await this.#models.put(model);
  }

  /**
   * Removes a model and its key, the key first. A key left from a model whose file is already gone
   * is removed too. None of either is fine.
   */
  async removeModel(id: ModelId): Promise<void> {
    await this.#credentials.remove(id);
    await this.#models.remove(id);
  }

  /**
   * Which models have keys, and the names of the fields set, never their values: what a UI shows
   * to say "a key is set" with no way to read it back.
   */
  async secretFields(): Promise<Record<string, string[]>> {
    return this.#credentials.fieldsSet();
  }

  /** The secrets of model `id`, to hand to its provider, or `undefined` when it has none. */
  async getSecrets(id: ModelId): Promise<Secrets | undefined> {
    return this.#credentials.get(id);
  }

  /**
   * Sets model `id`'s secrets, replacing the ones it had. Throws a `RegistryError` (`unknown_model`)
   * when the profile has no such model: a key for nothing is a typo, not a setting.
   */
  async putSecrets(params: { id: ModelId; secrets: Secrets }): Promise<void> {
    const { id, secrets } = params;

    await this.#assertProfile();

    if (!(await this.#models.get(id))) {
      throw new RegistryError({
        reason: 'unknown_model',
        message: `Profile ${this.id} has no model ${id}: add the model before its key`,
      });
    }

    await this.#credentials.put({ id, secrets });
  }

  async #assertProfile(): Promise<void> {
    await requireProfile({ profiles: this.#profiles, id: this.id });
  }
}
