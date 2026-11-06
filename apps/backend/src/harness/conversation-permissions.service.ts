import type { CommandPermissions } from '@sheavly/coding/run-command/run-command.types';
import type { AllowEntry, Permissions } from '@sheavly/protocol/permission/permission.types';
import type { PermissionStore } from '@sheavly/storage/permission-store/permission-store.service';

/** One conversation's temporary grants, shared by its tools and sub-agents, never saved on disk. */
export class ConversationPermissions implements CommandPermissions {
  readonly #store: PermissionStore;
  readonly #workspace: string;
  readonly #session = new Set<AllowEntry>();

  constructor(params: { store: PermissionStore; workspace: string }) {
    this.#store = params.store;
    this.#workspace = params.workspace;
  }

  /** Stored policy is read fresh so switching to always_ask still overrides session grants. */
  async read(): Promise<Permissions> {
    const stored = await this.#store.read(this.#workspace);

    return { ...stored, allow: [...new Set([...stored.allow, ...this.#session])] };
  }

  allow(entry: AllowEntry): Promise<void> {
    return this.#store.allow({ realPath: this.#workspace, entry });
  }

  allowSession(entry: AllowEntry): Promise<void> {
    this.#session.add(entry);

    return Promise.resolve();
  }
}
