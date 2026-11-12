import path from 'node:path';
import type {
  AllowEntry,
  PermissionMode,
  Permissions,
} from '@sheavly/protocol/permission/permission.types';
import { workspaceKey } from '../config-store/config-store.utils.js';
import { workspaceKeySchema } from '../config-store/config-store.validator.js';
import { StorageFileError } from '../errors/storage.errors.js';
import { readJsonFile, writeJsonFile } from '../json-file/json-file.helper.js';
import { assertSafeRoot, namedPath } from '../safe-path/safe-path.helper.js';
import { SerialQueue } from '../serial-queue/serial-queue.service.js';
import { DEFAULT_PERMISSIONS, PERMISSIONS_FOLDER } from './permission-store.constants.js';
import { permissionFileSchema } from './permission-store.validator.js';

/**
 * What each workspace lets `run_command` do, one `permissions/<workspace-key>.json` under the
 * user's folder (`~/.sheavly`): the mode, and the commands the user allowed for good. It is not
 * under a profile, since a folder's permissions are the same whichever profile runs in it, and it
 * is never in the repo, where the agent could edit it.
 *
 * A workspace is named by its real path (symlinks followed, as `workspaceKey` needs). Nothing
 * stored yet is the default: `ask`, with nothing allowed. A change reads the file and writes it
 * back whole, one after the other, so two at once never erase each other; a file that cannot be
 * read stops a change instead of being replaced.
 */
export class PermissionStore {
  readonly #folder: string;
  readonly #writes = new SerialQueue();

  /** `root` is the user's folder (`~/.sheavly`), which an app passes in. */
  constructor(params: { root: string }) {
    this.#folder = path.join(assertSafeRoot(params.root), PERMISSIONS_FOLDER);
  }

  /** The workspace's mode and allowed commands; the default when none is stored. */
  async read(realPath: string): Promise<Permissions> {
    return (await this.#load(realPath)).permissions;
  }

  /** Sets the workspace's mode, for every conversation running in it from its next command. */
  async setMode(params: { realPath: string; mode: PermissionMode }): Promise<void> {
    await this.#change(params.realPath, (current) => ({ ...current, mode: params.mode }));
  }

  /** Allows a command for good; one allowed already is not added twice. */
  async allow(params: { realPath: string; entry: AllowEntry }): Promise<void> {
    await this.#change(params.realPath, (current) =>
      current.allow.includes(params.entry)
        ? current
        : { ...current, allow: [...current.allow, params.entry] },
    );
  }

  /** Stops allowing a command; one that was not allowed is fine. */
  async revoke(params: { realPath: string; entry: AllowEntry }): Promise<void> {
    await this.#change(params.realPath, (current) => ({
      ...current,
      allow: current.allow.filter((entry) => entry !== params.entry),
    }));
  }

  async #load(realPath: string): Promise<{ file: string; permissions: Permissions }> {
    const key = workspaceKey({ realPath });
    const file = namedPath({
      folder: this.#folder,
      id: key,
      extension: '.json',
      shape: workspaceKeySchema,
    });
    const stored = await readJsonFile({ file, schema: permissionFileSchema, holdsSecrets: false });

    if (!stored) return { file, permissions: { mode: DEFAULT_PERMISSIONS.mode, allow: [] } };

    // The file's name is a hash of its root, so one copied or renamed by hand to another name is
    // refused, not taken to allow commands for a folder it was never written for.
    if (workspaceKey({ realPath: stored.root }) !== key) {
      throw new StorageFileError({
        file,
        cause: undefined,
        reason: `it names a root (${stored.root}) that is not this workspace's`,
      });
    }

    return { file, permissions: { mode: stored.mode, allow: stored.allow } };
  }

  /**
   * Writes what `update` makes of the current permissions. Throws before writing when the result
   * is not one this store could read back (an entry that is not a valid one): a file that can't
   * be read would stop every later command.
   */
  #change(realPath: string, update: (current: Permissions) => Permissions): Promise<void> {
    return this.#writes.run(async () => {
      const { file, permissions } = await this.#load(realPath);
      const value = permissionFileSchema.parse({ root: realPath, ...update(permissions) });

      await writeJsonFile({ file, value });
    });
  }
}
