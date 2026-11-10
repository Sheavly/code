import type { CommandPermissions } from '@sheavly/coding/run-command/run-command.types';
import type { Environment } from '@sheavly/core/environment/environment.types';
import type { AllowEntry, Permissions } from '@sheavly/protocol/permission/permission.types';
import type { PermissionStore } from '@sheavly/storage/permission-store/permission-store.service';
import { PathCheckError } from '@sheavly/workspace/errors/workspace.errors';
import { permissionRoot } from '../profiles/permission-root.helper.js';

/** One conversation's temporary grants, shared by its tools and sub-agents, never saved on disk. */
export class ConversationPermissions implements CommandPermissions {
  readonly #store: PermissionStore;
  readonly #workspace: string;
  readonly #env: Environment;
  readonly #session = new Set<AllowEntry>();

  constructor(params: { store: PermissionStore; workspace: string; env: Environment }) {
    this.#store = params.store;
    this.#workspace = params.workspace;
    this.#env = params.env;
  }

  /**
   * Stored policy is read fresh so switching to always_ask still overrides session grants. When
   * git cannot be checked, the shared file can't be found: every command asks, with nothing
   * allowed, rather than falling back to the folder's own file, which may hold looser entries.
   */
  async read(): Promise<Permissions> {
    try {
      // Looked up on every call, since a worktree can be added or removed while a conversation runs.
      const stored = await this.#store.read(
        await permissionRoot({ workspace: this.#workspace, env: this.#env }),
      );

      return { ...stored, allow: [...new Set([...stored.allow, ...this.#session])] };
    } catch (caughtError) {
      if (caughtError instanceof PathCheckError) return { mode: 'always_ask', allow: [] };

      throw caughtError;
    }
  }

  /** Throws a `PathCheckError` when git cannot be checked: the entry would land on the wrong file. */
  async allow(entry: AllowEntry): Promise<void> {
    await this.#store.allow({
      realPath: await permissionRoot({ workspace: this.#workspace, env: this.#env }),
      entry,
    });
  }

  allowSession(entry: AllowEntry): Promise<void> {
    this.#session.add(entry);

    return Promise.resolve();
  }
}
