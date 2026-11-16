import path from 'node:path';
import type { Profile, ProfileId } from '@sheavly/protocol/profile/profile.types';
import { profileIdSchema, profileSchema } from '@sheavly/protocol/profile/profile.validator';
import { StorageFileError } from '../errors/storage.errors.js';
import { readJsonFile, writeJsonFile } from '../json-file/json-file.helper.js';
import { listFolderNames } from '../listing/listing.helper.js';
import type { ListedFile } from '../listing/listing.types.js';
import { sortByName, splitListed } from '../listing/listing.utils.js';
import { assertSafeRoot, namedPath, removeFolder } from '../safe-path/safe-path.helper.js';
import { PROFILE_FILE, PROFILES_FOLDER } from './profile-store.constants.js';
import type { ProfileListing } from './profile-store.types.js';

/**
 * The profiles under the user's folder: `<root>/profiles/<profile-id>/profile.json`, one folder
 * each, holding that profile's models, keys and conversations. A profile is its id, which is also
 * its folder's name, so a folder copied or renamed by hand is refused and not served under a name
 * that is not its own.
 *
 * Deleting a profile deletes its folder and everything in it, its keys included. That is the point
 * of keeping them inside: nothing of a deleted profile is left on disk. The config that names it
 * is the config store's (`ConfigStore.forgetProfile`).
 */
export class ProfileStore {
  readonly #folder: string;

  /** `root` is the user's folder (`~/.sheavly`), which an app passes in. */
  constructor(params: { root: string }) {
    this.#folder = path.join(assertSafeRoot(params.root), PROFILES_FOLDER);
  }

  /** The folder of profile `id`: where its models, keys and conversations are kept. */
  folderOf(id: ProfileId): string {
    return namedPath({ folder: this.#folder, name: id });
  }

  /**
   * Every profile, and a problem for each folder that is not one: damaged, without a
   * `profile.json`, not named for the id inside it, or named for no id at all. One bad folder never
   * hides the rest. Files, and folders that start with a dot, are not profiles and not problems
   * (macOS and editors leave them). No folder yet is an empty listing.
   */
  async list(): Promise<ProfileListing> {
    const names = await this.#profileFolderNames();
    const { items, problems } = splitListed(
      await Promise.all(names.map((name) => this.#readListed(name))),
    );

    return { profiles: sortByName(items), problems };
  }

  /**
   * The profile with this id, or `undefined` when there is none. A `profile.json` that exists but
   * cannot be used (damaged, or its id is not its folder's name) throws a `StorageFileError` naming
   * it: the profile was asked for, and it must not look absent.
   */
  async get(id: ProfileId): Promise<Profile | undefined> {
    return this.#read(id);
  }

  /** Stores `profile`, creating its folder, and replacing the name of one with its id. */
  async put(profile: Profile): Promise<void> {
    await writeJsonFile({
      file: path.join(this.folderOf(profile.id), PROFILE_FILE),
      value: profile,
    });
  }

  /**
   * Deletes profile `id`: its folder and everything in it, its models, keys and conversations.
   * None is fine. A folder that is a symbolic link is removed as the link only, never its target's
   * contents, and no link inside is followed. Tell the config (`ConfigStore.forgetProfile`) too.
   */
  async remove(id: ProfileId): Promise<void> {
    await removeFolder({ root: this.#folder, folder: this.folderOf(id) });
  }

  /** The folders that could be profiles: folders (or links to one), not hidden, in a fixed order. */
  async #profileFolderNames(): Promise<string[]> {
    return listFolderNames({ folder: this.#folder, followLinks: true });
  }

  async #read(id: ProfileId): Promise<Profile | undefined> {
    const file = path.join(this.folderOf(id), PROFILE_FILE);
    const stored = await readJsonFile({ file, schema: profileSchema, holdsSecrets: false });

    if (!stored) return undefined;

    if (stored.id !== id) {
      throw new StorageFileError({
        file,
        cause: undefined,
        reason: `it holds the profile ${stored.id}, but its folder is named for ${id}: a copy or a rename by hand. Name each folder after the id in its profile.json`,
      });
    }

    return stored;
  }

  /** One folder of the listing: its profile, or what is wrong with it. */
  async #readListed(name: string): Promise<ListedFile<Profile>> {
    const folder = path.join(this.#folder, name);
    const id = profileIdSchema.safeParse(name);

    if (!id.success) {
      return {
        problem: {
          file: folder,
          message:
            'its name is not a profile id. Name the folder after the id in its profile.json, a lowercase UUID',
        },
      };
    }

    try {
      const profile = await this.#read(id.data);

      return profile
        ? { item: profile }
        : { problem: { file: folder, message: `it has no ${PROFILE_FILE}` } };
    } catch (caughtError) {
      // Only a profile.json that cannot be used is a problem to list; any other failure is not ours to hide.
      if (caughtError instanceof StorageFileError) {
        return { problem: { file: caughtError.file, message: caughtError.message } };
      }

      throw caughtError;
    }
  }
}
