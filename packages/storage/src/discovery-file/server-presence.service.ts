import type { DiscoveryFile } from '@sheavly/protocol/discovery/discovery.types';
import { errorMessage } from '@sheavly/runtime/errors/errors.utils';
import { acquireServerLock } from '../server-lock/server-lock.helper.js';
import type { ServerLockResult } from '../server-lock/server-lock.types.js';
import { serverRuntimeDirectory } from '../server-runtime/server-runtime.helper.js';
import type { PublishResult, RemoveResult } from './discovery-file.types.js';
import { publishDiscoveryFile } from './publish-discovery-file.helper.js';
import { readDiscoveryFile } from './read-discovery-file.helper.js';
import { removeDiscoveryFile } from './remove-discovery-file.helper.js';
import type { ClaimResult, ServerPresenceParams } from './server-presence.types.js';
import { firstServerFrom } from './server-presence.utils.js';

type HeldLock = Extract<ServerLockResult, { status: 'acquired' }>;

/**
 * A server's presence on its machine: the single-server lock and the discovery file, in the order
 * a backend uses them: `claim`, listen, `publish`, and on the way out `remove` then `release`
 * (`release` first is safe too). Only a `held` claim should stop a server; every other failure is
 * a warning through `log`, because a server that cannot be discovered still serves. No method
 * rejects and each can be called again.
 */
export class ServerPresence {
  readonly #params: ServerPresenceParams;
  #claim: Promise<ClaimResult> | undefined;
  #closed = false;
  #directory: string | undefined;
  #lock: HeldLock | undefined;
  #published: DiscoveryFile['instanceId'] | undefined;

  constructor(params: ServerPresenceParams) {
    this.#params = params;
  }

  /**
   * Takes the lock of the home. `held` carries who holds it, read from their discovery file when
   * there is one. A second call returns the first call's answer. After `release` nothing is
   * taken: the answer is `unavailable`, without a warning.
   */
  claim(): Promise<ClaimResult> {
    if (this.#closed) return Promise.resolve({ status: 'unavailable' });

    this.#claim ??= this.#claimOnce();

    return this.#claim;
  }

  /** Writes the discovery file, only while the lock is held: without one it does nothing. */
  async publish(value: DiscoveryFile): Promise<void> {
    const directory = this.#directory;

    if (this.#lock === undefined || directory === undefined) return;

    try {
      const { uid, platform = process.platform } = this.#params;
      const result = await publishDiscoveryFile({ directory, uid, platform, value });

      if (result.status === 'published') {
        this.#published = value.instanceId;

        return;
      }

      this.#warn(`The discovery file was not written: ${describePublish(result)}`);
    } catch (caughtError) {
      this.#warn(`The discovery file was not written: ${errorMessage(caughtError)}`);
    }
  }

  /** Removes the file this presence published, unless another server's is there by now. */
  async remove(): Promise<void> {
    const directory = this.#directory;
    const instanceId = this.#published;

    if (directory === undefined || instanceId === undefined) return;

    this.#published = undefined;

    try {
      const { uid, platform = process.platform } = this.#params;
      const result = await removeDiscoveryFile({ directory, uid, platform, instanceId });

      this.#warnIfNotRemoved(result);
    } catch (caughtError) {
      this.#warn(`The discovery file was not removed: ${errorMessage(caughtError)}`);
    }
  }

  /**
   * Lets go of the lock, so the next server of this home can take it, after a claim still in
   * flight has finished. It closes this presence: a later `claim` takes nothing and `publish`
   * writes nothing.
   */
  async release(): Promise<void> {
    this.#closed = true;
    // `#claimOnce` never rejects; waiting for it is what lets a lock taken meanwhile be released.
    await this.#claim;

    const lock = this.#lock;

    this.#lock = undefined;

    try {
      await lock?.release();
    } catch (caughtError) {
      this.#warn(`The server lock was not released: ${errorMessage(caughtError)}`);
    }
  }

  async #claimOnce(): Promise<ClaimResult> {
    try {
      return await this.#take();
    } catch (caughtError) {
      this.#warn(`The server lock could not be taken: ${errorMessage(caughtError)}`);

      return { status: 'unavailable' };
    }
  }

  async #take(): Promise<ClaimResult> {
    const { home, env, uid, platform = process.platform } = this.#params;
    const runtime = await serverRuntimeDirectory({ env, home, platform, uid });

    if (runtime.status === 'unusable') {
      this.#warn(
        `The folder for the server lock and its discovery file, ${runtime.directory}, cannot be used (${runtime.problem}: ${runtime.detail}), so this server runs without them`,
      );

      return { status: 'unavailable' };
    }

    if (runtime.warning !== undefined) this.#warn(runtime.warning);

    const lock = await acquireServerLock({ home, runtimeDir: runtime.directory, platform });

    if (lock.status === 'acquired') {
      this.#lock = lock;
      this.#directory = runtime.directory;

      return { status: 'claimed' };
    }

    if (lock.status === 'held') {
      const read = await readDiscoveryFile({ directory: runtime.directory, uid, platform });

      return { status: 'held', path: lock.path, first: firstServerFrom(read) };
    }

    this.#warn(
      `The server lock could not be taken (${lock.reason}${lock.cause === undefined ? '' : `: ${errorMessage(lock.cause)}`}), so this server runs without one`,
    );

    return { status: 'unavailable' };
  }

  #warnIfNotRemoved(result: RemoveResult): void {
    if (result.status === 'failed') {
      this.#warn(`The discovery file was not removed: ${errorMessage(result.cause)}`);
    } else if (result.status === 'left' && result.reason === 'unreadable') {
      this.#warn('The discovery file could not be read, so it was left in place');
    }
  }

  #warn(message: string): void {
    this.#params.log(`Warning: ${message}`);
  }
}

function describePublish(result: Exclude<PublishResult, { status: 'published' }>): string {
  if (result.status === 'failed') return errorMessage(result.cause);

  return result.reason === 'folder' ? `folder ${result.detail}` : result.reason;
}
