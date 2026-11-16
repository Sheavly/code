import path from 'node:path';
import type { ProfileId } from '@sheavly/protocol/profile/profile.types';
import type { TerminalSettings } from '@sheavly/protocol/terminal-settings/terminal-settings.types';
import { assertSafeRoot } from '../safe-path/safe-path.helper.js';
import { readJsonFile, writeJsonFile } from '../json-file/json-file.helper.js';
import { LockedChange } from '../serial-queue/locked-change.service.js';
import { CONFIG_FILE } from './config-store.constants.js';
import type { Config } from './config-store.types.js';
import { configFileSchema } from './config-store.validator.js';

/**
 * The user's `config.json`, directly under the root (`~/.sheavly`): the default profile, and the
 * profile each workspace uses (by its `workspaceKey`; one not bound uses the default). It holds
 * ids and user-wide terminal preferences, never a name, path or secret.
 *
 * Every change reads the file and writes it back whole, one after the other, so two at once never
 * erase each other. A file that cannot be read stops a change instead of being replaced.
 */
export class ConfigStore {
  readonly #file: string;
  readonly #writes: LockedChange;

  /** `root` is the user's folder (`~/.sheavly`), which an app passes in. */
  constructor(params: { root: string }) {
    this.#file = path.join(assertSafeRoot(params.root), CONFIG_FILE);
    this.#writes = new LockedChange({ name: this.#file });
  }

  /** The config; none stored yet is an empty one: no default profile, no bindings. */
  async read(): Promise<Config> {
    return (
      (await readJsonFile({ file: this.#file, schema: configFileSchema, holdsSecrets: false })) ?? {
        workspaces: {},
      }
    );
  }

  /** Makes `profile` the default for workspaces not bound to one. */
  async setDefaultProfile(profile: ProfileId): Promise<void> {
    await this.#change((config) => ({ ...config, defaultProfile: profile }));
  }

  /** Replaces user-wide terminal preferences without changing profile bindings. */
  async setTerminalSettings(terminal: TerminalSettings): Promise<void> {
    await this.#change((config) => ({ ...config, terminal }));
  }

  /** Binds the workspace with this key to `profile`, replacing a binding it had. */
  async bindWorkspace(params: { key: string; profile: ProfileId }): Promise<void> {
    const { key, profile } = params;

    await this.#change((config) => ({
      ...config,
      workspaces: { ...config.workspaces, [key]: profile },
    }));
  }

  /** Unbinds the workspace with this key, so it uses the default again; none bound is fine. */
  async unbindWorkspace(key: string): Promise<void> {
    await this.#change((config) => ({
      ...config,
      workspaces: Object.fromEntries(
        Object.entries(config.workspaces).filter(([bound]) => bound !== key),
      ),
    }));
  }

  /**
   * The profile the workspace with this key uses: its binding, else the default, else `undefined`
   * (no profile has been chosen yet, which is what onboarding is for).
   */
  async profileFor(key: string): Promise<ProfileId | undefined> {
    const config = await this.read();

    return config.workspaces[key] ?? config.defaultProfile;
  }

  /**
   * Takes a deleted profile out of the config: it stops being the default, and every workspace
   * bound to it is unbound, so config never points at a profile that is gone. Whoever deletes a
   * profile calls it; the profile may be named in neither, which is fine.
   */
  async forgetProfile(profile: ProfileId): Promise<void> {
    await this.#change(({ defaultProfile, workspaces, ...settings }) => ({
      ...settings,
      ...(defaultProfile !== undefined && defaultProfile !== profile && { defaultProfile }),
      workspaces: Object.fromEntries(
        Object.entries(workspaces).filter(([, bound]) => bound !== profile),
      ),
    }));
  }

  #change(update: (config: Config) => Config): Promise<void> {
    return this.#writes.run(async () => {
      await writeJsonFile({ file: this.#file, value: update(await this.read()) });
    });
  }
}
