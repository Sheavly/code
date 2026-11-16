import type { ModelId, ModelMode } from '@sheavly/protocol/model/model.types';
import type { Profile, ProfileId } from '@sheavly/protocol/profile/profile.types';
import type { TerminalSettings } from '@sheavly/protocol/terminal-settings/terminal-settings.types';
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
  /** Profile writes and deletion go one at a time, so migration cannot recreate a deleted profile. */
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
   * Makes or renames a profile, preserving remembered model choices and legacy preferences
   * that have not been migrated yet.
   */
  async put(params: { id: ProfileId; name: string }): Promise<void> {
    await this.#profileWrites.run(async () => {
      const existing = await this.#profiles.get(params.id);

      await this.#profiles.put({
        ...existing,
        id: params.id,
        name: params.name,
      });
    });
  }

  /**
   * Remembers the model and effort together. An omitted mode restores this model's own last
   * effort, or medium when none exists. It is a hint: a model removed since is simply not found
   * by whoever reads it, and the next choice replaces it. Throws a `RegistryError`
   * (`unknown_profile`) when there is no such profile.
   */
  async rememberModel(params: {
    id: ProfileId;
    modelId: ModelId;
    mode?: ModelMode;
  }): Promise<void> {
    const { id, modelId } = params;

    await this.#profileWrites.run(async () => {
      const profile = await requireProfile({ profiles: this.#profiles, id });

      const mode = params.mode ?? profile.modelModes?.[modelId] ?? 'medium';

      await this.#profiles.put({
        ...profile,
        lastModelSelection: { modelId, mode },
        modelModes: { ...profile.modelModes, [modelId]: mode },
      });
    });
  }

  /**
   * Deletes a profile with everything in it, its models, keys and conversations, and takes it out
   * of the config (as the default, and from every workspace bound to it). The config goes first: if
   * the folder can't then be removed, the profile is still there, unbound, and deleting it again
   * finishes the job. The other way round could leave the config naming a profile that is gone.
   */
  async delete(id: ProfileId): Promise<void> {
    await this.#profileWrites.run(async () => {
      await this.#config.forgetProfile(id);
      await this.#profiles.remove(id);
      this.#open.delete(id);
    });
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

  async setTerminalSettings(terminal: TerminalSettings): Promise<void> {
    await this.#config.setTerminalSettings(terminal);
  }

  /** Saves global preferences before removing legacy ones, so an interrupted migration is retryable. */
  async migrateTerminalSettings(): Promise<TerminalSettings> {
    return this.#profileWrites.run(async () => {
      const { profiles } = await this.#profiles.list();
      const legacy = profiles.filter(({ terminal }) => terminal !== undefined);

      if (legacy.length === 0) return (await this.#config.read()).terminal ?? {};

      // Any enabled legacy preference wins unless the user has already made a global choice.
      const terminal = await this.#config.initializeTerminalSettings({
        reducedMotion: legacy.some((profile) => profile.terminal?.reducedMotion === true),
      });

      for (const { terminal: _legacy, ...profile } of legacy) {
        await this.#profiles.put(profile);
      }

      return terminal;
    });
  }

  /** Makes profile `id` the default for workspaces not bound to one; it must exist. */
  async setDefaultProfile(id: ProfileId): Promise<void> {
    // In the profile queue with `delete`, so the profile checked is still there when config is
    // written: a delete cannot land between the check and the write.
    await this.#profileWrites.run(async () => {
      await requireProfile({ profiles: this.#profiles, id });
      await this.#config.setDefaultProfile(id);
    });
  }

  /** Binds the workspace with this key (see `workspaceKey`) to a profile, which must exist. */
  async bindWorkspace(params: { key: string; profile: ProfileId }): Promise<void> {
    await this.#profileWrites.run(async () => {
      await requireProfile({ profiles: this.#profiles, id: params.profile });
      await this.#config.bindWorkspace(params);
    });
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
