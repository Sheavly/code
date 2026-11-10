import { BUILT_IN_ALLOW } from '@sheavly/coding/run-command/allow-list.constants';
import type {
  AllowEntry,
  PermissionMode,
  WorkspacePermissions,
} from '@sheavly/protocol/permission/permission.types';
import type { PermissionStore } from '@sheavly/storage/permission-store/permission-store.service';
import type { Environment } from '@sheavly/core/environment/environment.types';
import { permissionRoot } from './permission-root.helper.js';
import { TIGHTEST_MODE } from './profiles.constants.js';
import { assertRemoteSetupAllowed } from './remote-setup.helper.js';
import { resolveWorkspace } from './workspace-path.helper.js';

/**
 * What a UI does with a folder's command permissions: read them, set the mode, allow a command
 * for good, or stop allowing it. The store is the one `run_command` reads on every command, so a
 * change applies to the conversations already running in the folder from their next command.
 *
 * Every folder named is checked as a conversation's workspace is (`resolveWorkspace`), so none
 * that couldn't be worked in can be given permissions. Reading and tightening are open to any
 * backend; what loosens what the agent may run (allowing a command, any mode but the tightest)
 * needs `remoteSetupAllowed`, since over a network it would hand a stranger the user's shell.
 * Revoking an entry, which only takes power away, never does.
 */
export class PermissionSetup {
  readonly #store: PermissionStore;
  readonly #home: string;
  readonly #remoteSetupAllowed: boolean;
  readonly #env: Environment;

  constructor(params: {
    store: PermissionStore;
    home: string;
    env: Environment;
    remoteSetupAllowed: boolean;
  }) {
    this.#store = params.store;
    this.#home = params.home;
    this.#env = params.env;
    this.#remoteSetupAllowed = params.remoteSetupAllowed;
  }

  /** The folder's mode, the commands the user allowed, and the built-in ones. */
  async read(workspace: string): Promise<WorkspacePermissions> {
    const real = await this.#real(workspace);
    const stored = await this.#store.read(
      await permissionRoot({ workspace: real, env: this.#env }),
    );

    return { workspace: real, ...stored, builtIn: [...BUILT_IN_ALLOW] };
  }

  /** Sets the folder's mode. `forbidden` when it loosens and the backend is not local. */
  async setMode(params: { workspace: string; mode: PermissionMode }): Promise<void> {
    const { workspace, mode } = params;

    if (mode !== TIGHTEST_MODE) {
      assertRemoteSetupAllowed({
        allowed: this.#remoteSetupAllowed,
        refuses: `takes no change to how the agent may run commands, other than ${TIGHTEST_MODE}`,
      });
    }

    const real = await this.#real(workspace);

    await this.#store.setMode({
      realPath: await permissionRoot({ workspace: real, env: this.#env }),
      mode,
    });
  }

  /** Allows `entry` in the folder for good. `forbidden` unless the backend is local. */
  async allow(params: { workspace: string; entry: AllowEntry }): Promise<void> {
    assertRemoteSetupAllowed({
      allowed: this.#remoteSetupAllowed,
      refuses: 'allows no command for the agent to run',
    });

    const real = await this.#real(params.workspace);

    await this.#store.allow({
      realPath: await permissionRoot({ workspace: real, env: this.#env }),
      entry: params.entry,
    });
  }

  /** Stops allowing `entry` in the folder; one that was not allowed is fine. */
  async revoke(params: { workspace: string; entry: AllowEntry }): Promise<void> {
    const real = await this.#real(params.workspace);

    await this.#store.revoke({
      realPath: await permissionRoot({ workspace: real, env: this.#env }),
      entry: params.entry,
    });
  }

  #real(workspace: string): Promise<string> {
    return resolveWorkspace({ requested: workspace, sheavlyHome: this.#home });
  }
}
