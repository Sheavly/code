import path from 'node:path';
import { profileIdSchema } from '@sheavly/protocol/profile/profile.validator';
import { UnsafePathError } from '../errors/storage.errors.js';
import { ProfileStore } from '../profile-store/profile-store.service.js';
import { assertSafeRoot } from '../safe-path/safe-path.helper.js';
import { SETTINGS_FILE } from './settings-file.constants.js';
import { readSettingsFile } from './settings-file.helper.js';
import type { SettingsFileText } from './settings-file.types.js';

/**
 * The user's own settings files: `<root>/settings.json` (global) and
 * `<root>/profiles/<profile-id>/settings.json` (one profile's). They are written by hand, so
 * nothing here writes them, and a profile's goes when the profile is deleted, with its folder.
 * Each read returns the file's text and path, or `undefined` for a file that is not there (an
 * empty layer); an unusable one throws a `StorageFileError` (see `readSettingsFile`).
 */
export class SettingsFiles {
  readonly #root: string;
  readonly #profiles: ProfileStore;

  /** `root` is the user's folder (`~/.sheavly`), which an app passes in. */
  constructor(params: { root: string }) {
    this.#root = assertSafeRoot(params.root);
    this.#profiles = new ProfileStore({ root: this.#root });
  }

  /** The global settings file. */
  async readGlobal(): Promise<SettingsFileText | undefined> {
    return readSettingsFile({ file: path.join(this.#root, SETTINGS_FILE) });
  }

  /**
   * The settings file of profile `profileId`. A profile that has no folder has no file: an empty
   * layer, since whether the profile exists is the registry's to say. `profileId` is checked as a
   * profile id (a lowercase UUID) before any path is made, so a value that came from outside
   * can't climb out of the profile's folder: anything else throws an `UnsafePathError` and
   * nothing is read.
   */
  async readProfile(profileId: string): Promise<SettingsFileText | undefined> {
    const id = profileIdSchema.safeParse(profileId);

    if (!id.success) {
      throw new UnsafePathError({
        target: profileId,
        reason: 'it is not a profile id, so no settings file is read for it',
      });
    }

    return readSettingsFile({ file: path.join(this.#profiles.folderOf(id.data), SETTINGS_FILE) });
  }
}
