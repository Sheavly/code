import type { ModelId } from '@sheavly/protocol/model/model.types';
import type { Profile, ProfileId } from '@sheavly/protocol/profile/profile.types';
import { ConfigStore } from '../config-store/config-store.service.js';
import type { Config } from '../config-store/config-store.types.js';
import type { ProfileListing } from '../profile-store/profile-store.types.js';
import { ProfileStore } from '../profile-store/profile-store.service.js';
import { SerialQueue } from '../serial-queue/serial-queue.service.js';
import { OpenProfile } from './open-profile.service.js';
import { requireProfile } from './profile-registry.helper.js';

/**
 * Everything the harness keeps for a user, as one thing to ask: the profiles, the config that says
 * which one a workspace uses, and each profile's models and keys. It keeps the pieces in step:
 * config never names a profile that is gone, and a profile is deleted with everything in it.
 *
 * The backend uses this and not the stores under it, whose single-purpose methods don't keep each
 * other in step (removing a model through `ModelStore` would leave its key behind).
 */
export class ProfileRegistry {
  readonly #profiles: ProfileStore;
  readonly #config: ConfigStore;
  readonly #open = new Map<ProfileId, OpenProfile>();
  /** Every change to a `profile.json` reads it and writes it back, so they go one at a time. */
  readonly #profileWrites = new SerialQueue();

  /** `root` is the user's folder (`~/.sheavly`), which an app passes in. */
  constructor(params: { root: string }) {
    this.#profiles = new ProfileStore(params);
    this.#config = new ConfigStore(params);
  }

  /** The profiles, and a problem for each folder that isn't one (see `ProfileStore.list`). */
  async list(): Promise<ProfileListing> {
    return this.#profiles.list();
  }

  /** The profile with this id, or `undefined`. */
  async get(id: ProfileId): Promise<Profile | undefined> {
    return this.#profiles.get(id);
  }

  /**
   * Makes a profile, or renames the one with this id. The model it last chose is kept: a rename
   * changes the name and nothing else.
   */
  async put(params: { id: ProfileId; name: string }): Promise<void> {
    await this.#profileWrites.run(async () => {
      const existing = await this.#profiles.get(params.id);

      await this.#profiles.put({
        id: params.id,
        name: params.name,
        ...(existing?.lastModelId !== undefined && { lastModelId: existing.lastModelId }),
      });
    });
  }

  /**
   * Remembers `modelId` as the model last chosen in profile `id`: where its next new conversation
   * starts. It is a hint, not a reference kept in step: a model removed since is simply not found
   * by whoever reads it, and the next choice replaces it. Throws a `RegistryError`
   * (`unknown_profile`) when there is no such profile.
   */
  async rememberModel(params: { id: ProfileId; modelId: ModelId }): Promise<void> {
    const { id, modelId } = params;

    await this.#profileWrites.run(async () => {
      const profile = await requireProfile({ profiles: this.#profiles, id });

      await this.#profiles.put({ ...profile, lastModelId: modelId });
    });
  }

  /**
   * Deletes a profile with everything in it, its models, keys and conversations, and takes it out
   * of the config (as the default, and from every workspace bound to it). The config goes first: if
   * the folder can't then be removed, the profile is still there, unbound, and deleting it again
   * finishes the job. The other way round could leave the config naming a profile that is gone.
   */
  async delete(id: ProfileId): Promise<void> {
    await this.#config.forgetProfile(id);
    await this.#profiles.remove(id);
    this.#open.delete(id);
  }

  /**
   * Profile `id` opened for use. The same object every time for one profile, since its stores queue
   * their writes in memory. Throws a `RegistryError` (`unknown_profile`) when there is none.
   */
  async open(id: ProfileId): Promise<OpenProfile> {
    await requireProfile({ profiles: this.#profiles, id });

    // Looked up after the wait, so two opens at once still end with one object.
    let open = this.#open.get(id);

    if (!open) {
      open = new OpenProfile({ id, profiles: this.#profiles });
      this.#open.set(id, open);
    }

    return open;
  }

  /** The config as stored: the default profile and each workspace's binding. */
  async config(): Promise<Config> {
    return this.#config.read();
  }

  /** Makes profile `id` the default for workspaces not bound to one; it must exist. */
  async setDefaultProfile(id: ProfileId): Promise<void> {
    await requireProfile({ profiles: this.#profiles, id });
    await this.#config.setDefaultProfile(id);
  }

  /** Binds the workspace with this key (see `workspaceKey`) to a profile, which must exist. */
  async bindWorkspace(params: { key: string; profile: ProfileId }): Promise<void> {
    await requireProfile({ profiles: this.#profiles, id: params.profile });
    await this.#config.bindWorkspace(params);
  }

  /** Unbinds the workspace, so it uses the default again; none bound is fine. */
  async unbindWorkspace(key: string): Promise<void> {
    await this.#config.unbindWorkspace(key);
  }

  /**
   * The profile a workspace uses: the one it is bound to, else the default, else `undefined` (none
   * has been chosen: what onboarding is for). One that is named but gone, as when its folder was
   * deleted by hand, counts as not named, so the workspace falls back instead of failing.
   */
  async profileFor(key: string): Promise<Profile | undefined> {
    const { workspaces, defaultProfile } = await this.#config.read();

    for (const id of [workspaces[key], defaultProfile]) {
      const profile = id === undefined ? undefined : await this.#profiles.get(id);

      if (profile) return profile;
    }

    return undefined;
  }
}
