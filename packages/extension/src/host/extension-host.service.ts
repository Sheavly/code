import { ExtensionActivationError, ExtensionHostStateError } from '../errors/extension.errors.js';
import type {
  Contributions,
  Extension,
  ServiceKey,
  SettingValue,
} from '../extension/extension.types.js';
import { mergeContributions } from './contributions.utils.js';
import { orderExtensions, readableServices } from './extension-order.utils.js';
import { assertSettings, settingInfos, settingsFor } from './settings.utils.js';
import type {
  ActivationResult,
  ContributedBy,
  ExtensionHostOptions,
  SkippedExtension,
} from './extension-host.types.js';
import { ServiceRegistry } from './services.service.js';

/** How one extension's activation went. */
type ActivationStep =
  | { kind: 'closed' }
  | { kind: 'skipped'; reason: SkippedExtension['reason'] }
  | { kind: 'failed'; error: ExtensionActivationError }
  | { kind: 'activated'; contributions: Contributions };

/** What one `activate` call has recorded so far. */
type Progress = {
  contributed: ContributedBy[];
  failed: ExtensionActivationError[];
  skipped: SkippedExtension[];
  lateDeactivationErrors: unknown[];
  /** Extensions that did not activate: what depends on them is skipped. */
  unavailable: Set<string>;
};

/**
 * Activates a run's extensions: checks the graph and the settings, activates each in dependency
 * order, merges what they contribute and, at the end of the session, deactivates them in reverse.
 * It adds nothing of its own to the loop and imposes no category on an extension; the caller
 * passes the merged tools and hooks on.
 *
 * Setup mistakes (a repeated name, a missing or cyclic dependency, a setting value no extension
 * declares or of the wrong type, two extensions declaring one setting, two contributions with one
 * name, hooks placed in a cycle) throw. A single extension whose `activate` throws, or that is not
 * trusted (or whose trust check throws), is reported and skipped, along with the extensions that
 * depend on it, and the rest activate. The services of an extension that failed are dropped.
 *
 * A host lives one session: it activates once (a second `activate` throws) and closes once. An
 * extension whose `activate` threw is not deactivated, so `activate` must clean up after itself
 * before it throws.
 */
export class ExtensionHost {
  readonly #ordered: readonly Extension[];
  readonly #options: ExtensionHostOptions;
  readonly #services: ServiceRegistry;
  readonly #settings: Readonly<Record<string, SettingValue>>;
  #activated: Extension[] = [];
  #state: 'idle' | 'activating' | 'active' | 'closed' = 'idle';

  constructor(options: ExtensionHostOptions) {
    this.#ordered = orderExtensions(options.extensions);
    this.#settings = options.settings ?? {};
    assertSettings({ extensions: options.extensions, values: this.#settings });
    this.#services = new ServiceRegistry(options.services);
    this.#options = options;
  }

  /**
   * Activates every extension, once per session, then pass the contributions to the loop. Throws
   * `ExtensionHostStateError` on a second call. An aborted `signal` stops the activation: what was
   * activated is deactivated and the abort reason is thrown, as is a contribution collision.
   * If `deactivate()` runs meanwhile, `activate` returns with nothing running (see
   * `lateDeactivationErrors`).
   */
  async activate(params: { signal: AbortSignal }): Promise<ActivationResult> {
    if (this.#state !== 'idle') {
      throw new ExtensionHostStateError({ attempted: 'activate', state: this.#state });
    }

    this.#state = 'activating';

    const readable = readableServices(this.#ordered);
    const progress: Progress = {
      contributed: [],
      failed: [],
      skipped: [],
      lateDeactivationErrors: [],
      unavailable: new Set(),
    };

    try {
      for (const extension of this.#ordered) {
        // `deactivate` may run while an extension activates: nothing after it may start.
        if (this.#isClosed()) break;
        params.signal.throwIfAborted();

        const step = await this.#activateOne({
          extension,
          unavailable: progress.unavailable,
          readable,
          signal: params.signal,
        });

        if (!(await this.#record({ extension, step, progress }))) break;
      }

      // An abort during the last `activate` stops the run too, like one between two of them.
      params.signal.throwIfAborted();

      return this.#result(progress);
    } catch (caughtError) {
      // A collision or an abort during activation: don't leave activated extensions running.
      await this.deactivate();
      throw caughtError;
    }
  }

  /** Read through a method, not the field: an `await` in `activate` can close the host meanwhile. */
  #isClosed(): boolean {
    return this.#state === 'closed';
  }

  /**
   * Whether one extension is skipped, fails or activates. Its trust check and its `activate` are
   * isolated here: a throw from either is that extension's failure and drops what it provided.
   */
  async #activateOne(params: {
    extension: Extension;
    unavailable: ReadonlySet<string>;
    readable: ReadonlyMap<string, ReadonlySet<string>>;
    signal: AbortSignal;
  }): Promise<ActivationStep> {
    const { extension, unavailable, readable, signal } = params;

    try {
      const reason = await this.#skipReason({ extension, unavailable });

      if (reason) return { kind: 'skipped', reason };

      // The trust check awaited: `deactivate` may have closed the host meanwhile.
      if (this.#isClosed()) return { kind: 'closed' };

      const contributions = await extension.activate({
        extension: extension.name,
        services: this.#services.viewFor({
          extension: extension.name,
          readable: readable.get(extension.name) ?? new Set(),
        }),
        settings: settingsFor({ extension, values: this.#settings }),
        signal,
      });

      return { kind: 'activated', contributions };
    } catch (caughtError) {
      this.#services.forget(extension.name);

      return {
        kind: 'failed',
        error: new ExtensionActivationError({ extension: extension.name, cause: caughtError }),
      };
    }
  }

  /**
   * Keeps what a step produced in `progress` (and the activated extension in the host), and says
   * whether to go on: not once the host closed. An extension that finished after the close is
   * stopped here, since `deactivate` never knew it; its error is kept, not thrown.
   */
  async #record(params: {
    extension: Extension;
    step: ActivationStep;
    progress: Progress;
  }): Promise<boolean> {
    const { extension, step, progress } = params;

    if (step.kind === 'closed') return false;

    if (step.kind === 'activated') {
      if (this.#isClosed()) {
        await this.#stopLate({ extension, errors: progress.lateDeactivationErrors });

        return false;
      }

      this.#activated.push(extension);
      progress.contributed.push({ extension: extension.name, contributions: step.contributions });

      return true;
    }

    progress.unavailable.add(extension.name);

    if (step.kind === 'skipped') {
      progress.skipped.push({ extension: extension.name, reason: step.reason });
    } else {
      progress.failed.push(step.error);
    }

    return true;
  }

  /** The result of an `activate` that ran to its end: nothing is reported running if the host closed meanwhile. */
  #result(progress: Progress): ActivationResult {
    const { failed, skipped, lateDeactivationErrors } = progress;

    if (this.#isClosed()) {
      return {
        contributions: mergeContributions([]),
        active: [],
        settings: [],
        failed,
        skipped,
        lateDeactivationErrors,
      };
    }

    this.#state = 'active';

    return {
      contributions: mergeContributions(progress.contributed),
      active: this.#activated.map((extension) => extension.name),
      settings: settingInfos({ extensions: this.#activated, values: this.#settings }),
      failed,
      skipped,
      lateDeactivationErrors,
    };
  }

  /** Deactivates an extension that finished activating after the host closed; an error is kept, never thrown. */
  async #stopLate(params: { extension: Extension; errors: unknown[] }): Promise<void> {
    try {
      await params.extension.deactivate?.();
    } catch (caughtError) {
      params.errors.push(caughtError);
    }
  }

  /**
   * A service the host supplied or an activated extension provided, for the app composing the
   * run. Throws if none did.
   */
  service<TService>(key: ServiceKey<TService>): TService {
    return this.#services.read(key);
  }

  /**
   * Closes the host and deactivates the activated extensions, last first, once (a second call
   * does nothing). Called while `activate` is still running, it stops the rest from starting and
   * deactivates what finishes meanwhile. One extension's `deactivate` throwing never stops the
   * others; the errors come back for the caller to report.
   */
  async deactivate(): Promise<readonly unknown[]> {
    if (this.#state === 'closed') return [];

    this.#state = 'closed';

    const errors: unknown[] = [];

    for (const extension of [...this.#activated].reverse()) {
      try {
        await extension.deactivate?.();
      } catch (caughtError) {
        errors.push(caughtError);
      }
    }

    return errors;
  }

  async #skipReason(params: {
    extension: Extension;
    unavailable: ReadonlySet<string>;
  }): Promise<SkippedExtension['reason'] | undefined> {
    const { extension, unavailable } = params;

    if ((extension.dependsOn ?? []).some((name) => unavailable.has(name))) return 'dependency';

    // Only a declared builtin skips the gate: any other origin value is code to trust first.
    if (extension.origin === undefined || extension.origin === 'builtin') return undefined;

    return (await this.#options.isTrusted?.(extension)) === true ? undefined : 'untrusted';
  }
}
