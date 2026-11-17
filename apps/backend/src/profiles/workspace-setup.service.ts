import path from 'node:path';
import type { ProfileId } from '@sheavly/protocol/profile/profile.types';
import { workspaceKey } from '@sheavly/storage/config-store/config-store.utils';
import { RegistryError } from '@sheavly/storage/errors/registry.errors';
import type { ProfileRegistry } from '@sheavly/storage/profile-registry/profile-registry.service';
import type { TrustedWorkspace } from '@sheavly/coding/trust/trust.types';
import type { TrustStore } from '@sheavly/coding/trust/trust.service';
import { SetupError } from '../errors/setup.errors.js';
import { assertRemoteSetupAllowed } from './remote-setup.helper.js';
import { resolveWorkspace } from './workspace-path.helper.js';

/**
 * What a setup UI does with folders: which profile each one runs on, and which are trusted to run
 * their `.sheavly/` hooks. It shares `Profiles`' registry, so a binding shows in the next
 * conversation, and the one trust store the backend's conversations read.
 *
 * Every folder named in a call is checked as a conversation's workspace is (`resolveWorkspace`:
 * absolute, there, a folder, not a top or home or the keys' folder), so none that couldn't be worked
 * in can be bound or trusted. Revoking trust is the exception: a trusted folder that has since gone
 * must still be forgotten. `remoteSetupAllowed` is false when the backend listens beyond this
 * machine, where a grant of trust (it makes a repo's code run) must not travel.
 */
export class WorkspaceSetup {
  readonly #registry: ProfileRegistry;
  readonly #trust: TrustStore;
  readonly #home: string;
  readonly #remoteSetupAllowed: boolean;

  constructor(params: {
    registry: ProfileRegistry;
    trust: TrustStore;
    home: string;
    remoteSetupAllowed: boolean;
  }) {
    this.#registry = params.registry;
    this.#trust = params.trust;
    this.#home = params.home;
    this.#remoteSetupAllowed = params.remoteSetupAllowed;
  }

  /** The profile `workspace` runs on and whether it was chosen for it (else it is the default). */
  async profileOf(workspace: string): Promise<{
    workspace: string;
    profile?: ProfileId;
    bound: boolean;
  }> {
    const real = await resolveWorkspace({ requested: workspace, sheavlyHome: this.#home });
    const key = workspaceKey({ realPath: real });
    const { workspaces } = await this.#registry.config();
    const found = await this.#registry.profileFor(key);
    // A binding to a profile that is gone counts as none (see `ProfileRegistry.profileFor`).
    const bound = found !== undefined && workspaces[key] === found.id;

    return { workspace: real, ...(found && { profile: found.id }), bound };
  }

  /** Runs `workspace` on `profile` from now on. `not_found` when there is no such profile. */
  async bind(params: { workspace: string; profile: ProfileId }): Promise<void> {
    const real = await resolveWorkspace({ requested: params.workspace, sheavlyHome: this.#home });

    try {
      await this.#registry.bindWorkspace({
        key: workspaceKey({ realPath: real }),
        profile: params.profile,
      });
    } catch (caughtError) {
      // Only a profile that is not there is the caller's to fix; anything else is not ours to hide.
      if (!(caughtError instanceof RegistryError)) throw caughtError;
      throw new SetupError({
        reason: 'not_found',
        message: caughtError.message,
        cause: caughtError,
      });
    }
  }

  /** Runs `workspace` on the default profile again; none bound is fine. */
  async unbind(workspace: string): Promise<void> {
    const real = await resolveWorkspace({ requested: workspace, sheavlyHome: this.#home });

    await this.#registry.unbindWorkspace(workspaceKey({ realPath: real }));
  }

  /** The trusted workspaces, or those whose path has `search` (ignoring case). Oldest first. */
  async trusted(search?: string): Promise<TrustedWorkspace[]> {
    const listed = await this.#trust.list();

    if (!search) return listed;

    const wanted = search.toLowerCase();

    return listed.filter((each) => each.root.toLowerCase().includes(wanted));
  }

  /**
   * Trusts `workspace`'s `.sheavly/` hooks as they are now. `forbidden` unless this backend may
   * hand out access; `invalid` for a folder that can't be a workspace.
   */
  async trust(workspace: string): Promise<void> {
    assertRemoteSetupAllowed({
      allowed: this.#remoteSetupAllowed,
      refuses: 'takes no keys and grants no trust',
    });

    const real = await resolveWorkspace({ requested: workspace, sheavlyHome: this.#home });

    await this.#trust.trust({ root: real });
  }

  /**
   * Stops trusting `workspace`, also when its folder is gone. Never refused for a remote backend:
   * taking trust away is always safe.
   */
  async revoke(workspace: string): Promise<void> {
    if (!path.isAbsolute(workspace)) {
      throw new SetupError({
        reason: 'invalid',
        message: `The workspace ${workspace} cannot be used: give an absolute path`,
      });
    }

    await this.#trust.revoke({ root: workspace });
  }
}
