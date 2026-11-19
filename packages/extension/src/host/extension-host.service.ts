import type { Emitter } from '../emit/emit.types.js';
import { createEmitter } from '../emit/emit.utils.js';
import { ExtensionActivationError, ExtensionHostStateError } from '../errors/extension.errors.js';
import type {
  Contributions,
  Extension,
  ServiceConsumer,
  ServiceKey,
  SettingValue,
} from '../extension/extension.types.js';
import { sealExtension } from '../extension/extension.utils.js';
import { changedExtensions, snapshotContributions } from './contribution-snapshot.utils.js';
import { assertGrantsOffered, grantCatalogueOf } from './grant-catalogue.utils.js';
import { mergeContributions } from './contributions.utils.js';
import { orderExtensions, readableServices, withDependents } from './extension-order.utils.js';
import { assertSettings, settingInfos, settingsFor } from './settings.utils.js';
import type {
  ActivationResult,
  ActivationStep,
  ContributionSnapshot,
  ExtensionHostOptions,
  GrantCatalogue,
  Progress,
  SkippedExtension,
} from './extension-host.types.js';
import { isFinalState } from './extension-state.utils.js';
import type { ExtensionState } from './extension-state.types.js';
import { ExtensionStates } from './extension-states.service.js';
import { ServiceRegistry } from './services.service.js';

/**
 * Activates a run's extensions: checks the graph and the settings, activates each in dependency
 * order, merges what they contribute and, at the end of the session, deactivates them in reverse.
 * It adds nothing of its own to the loop and imposes no category on an extension; the caller
 * passes the merged tools and hooks on.
 *
 * Setup mistakes (a repeated name, a missing or cyclic dependency, a setting value no extension
 * declares or of the wrong type, two extensions declaring one setting, two contributions with one
 * name, hooks placed in a cycle) throw. A single extension whose `activate` throws, that is not
 * trusted (or whose trust check throws), that lacks a service its manifest requires, or that uses
 * or contributes what its manifest does not declare, is reported and skipped, along with the
 * extensions that depend on it, and the rest activate. The services of an extension that failed
 * are dropped.
 *
 * A host lives one session: it activates once (a second `activate` throws) and closes once. An
 * extension whose `activate` threw is not deactivated, so `activate` must clean up after itself
 * before it throws.
 */
export class ExtensionHost {
  readonly #ordered: readonly Extension[];
  readonly #options: ExtensionHostOptions;
  readonly #services: ServiceRegistry;
  /** The grants the supplied services declare; a manifest's `grants` are verified against it. */
  readonly #grants: GrantCatalogue;
  readonly #settings: Readonly<Record<string, SettingValue>>;
  /** Each extension's emit capability: disarmed wherever the host stops, drops or fails it. */
  readonly #emitters = new Map<string, Emitter>();
  /** Each extension's one state (see `EXTENSION_TRANSITIONS`); the tool names it contributed count once it is merged. */
  readonly #states: ExtensionStates;
  readonly #consumers = new Map<string, ServiceConsumer>();
  #activated: Extension[] = [];
  #state: 'idle' | 'activating' | 'active' | 'closed' = 'idle';

  constructor(options: ExtensionHostOptions) {
    // Every later read of an extension goes through this one frozen copy, never the caller's object.
    const sealed = options.extensions.map((extension) => sealExtension(extension));

    this.#ordered = orderExtensions(sealed);
    this.#states = new ExtensionStates(this.#ordered.map((extension) => extension.name));
    this.#settings = Object.freeze({ ...options.settings });
    assertSettings({ extensions: sealed, values: this.#settings });
    this.#services = new ServiceRegistry(options.services);
    this.#grants = grantCatalogueOf(options.services ?? []);
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
          progress,
          readable,
          signal: params.signal,
        });

        if (!(await this.#record({ extension, step, progress }))) break;
      }

      // An abort during the last `activate` stops the run too, like one between two of them.
      params.signal.throwIfAborted();

      return await this.#result(progress);
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
   * Whether one extension is skipped, fails or activates. Its trust check, its `activate` and the
   * check of what it contributed against its manifest are isolated here: a throw from any is that
   * extension's failure and drops what it provided.
   */
  async #activateOne(params: {
    extension: Extension;
    progress: Progress;
    readable: ReadonlyMap<string, ReadonlySet<string>>;
    signal: AbortSignal;
  }): Promise<ActivationStep> {
    const { extension, progress, readable, signal } = params;
    const readableNames = readable.get(extension.name) ?? new Set<string>();
    const emitter = createEmitter({ manifest: extension.manifest, sink: this.#options.emit });

    this.#emitters.set(extension.name, emitter);
    this.#enter({ extension: extension.name, to: 'activating' });

    try {
      const skipped = await this.#skipped({
        extension,
        unavailable: progress.unavailable,
        readable: readableNames,
      });

      if (skipped) {
        // The service check may have built this extension's factory instances: they must not outlive the skip.
        this.#enter({ extension: extension.name, to: 'skipped' });

        return { kind: 'skipped', skipped };
      }

      // The trust check awaited: `deactivate` may have closed the host meanwhile.
      if (this.#isClosed()) {
        this.#enter({ extension: extension.name, to: 'stopped' });

        return { kind: 'closed' };
      }

      assertGrantsOffered({ manifest: extension.manifest, catalogue: this.#grants });

      const contributions = await extension.activate({
        extension: extension.name,
        services: this.#services.viewFor({
          extension: this.#consumerOf(extension),
          readable: readableNames,
        }),
        settings: settingsFor({ extension, values: this.#settings }),
        emit: emitter.emit,
        signal,
      });

      const snapshot = await this.#holdToManifest({
        extension,
        contributions,
        errors: progress.lateDeactivationErrors,
      });

      // Armed only from the recorded names and versions of the checked snapshot, never from the
      // live objects the extension still holds.
      emitter.arm(snapshot.emittable);
      // Verified is not merged: the names are attributable only once the merge passed.
      this.#states.verify({
        extension: extension.name,
        tools: Object.freeze(snapshot.tools.map((entry) => entry.name)),
      });

      return { kind: 'activated', snapshot };
    } catch (caughtError) {
      // `activate` may have kept `context.emit` or a service: a failed extension must not use them.
      this.#enter({ extension: extension.name, to: 'failed' });
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
        this.#enter({ extension: extension.name, to: 'stopped' });
        await this.#stopLate({ extension, errors: progress.lateDeactivationErrors });

        return false;
      }

      this.#activated.push(extension);
      progress.contributed.push({ extension: extension.name, snapshot: step.snapshot });

      return true;
    }

    progress.unavailable.add(extension.name);

    if (step.kind === 'skipped') {
      progress.skipped.push(step.skipped);
    } else {
      progress.failed.push(step.error);
    }

    return true;
  }

  /**
   * An extension keeps its references to what it returned, and others activated since the check.
   * Before merging, an extension whose contributions changed meanwhile is failed like any other
   * verification failure: deactivated, its services dropped, and what depends on it deactivated
   * and skipped, so nothing unchecked is merged.
   */
  async #rollBackChanged(params: {
    changed: ReadonlyMap<string, unknown>;
    progress: Progress;
  }): Promise<void> {
    const { changed, progress } = params;
    const doomed = withDependents({ ordered: this.#activated, roots: new Set(changed.keys()) });
    const names = new Set(doomed.map((extension) => extension.name));

    // Taken out before the first `await`: a `deactivate()` meanwhile must not stop them a second time.
    this.#activated = this.#activated.filter((extension) => !names.has(extension.name));
    // Also before the first `await`: none of them may emit while the others are being stopped.
    doomed.forEach(({ name }) => this.#enter({ extension: name, to: 'rolled-back' }));
    progress.contributed = progress.contributed.filter(({ extension }) => !names.has(extension));

    for (const extension of doomed.toReversed()) {
      await this.#stopLate({ extension, errors: progress.lateDeactivationErrors });
      this.#services.forget(extension.name);

      const cause = changed.get(extension.name);

      if (cause === undefined) {
        progress.skipped.push({ extension: extension.name, reason: 'dependency' });
      } else {
        progress.failed.push(new ExtensionActivationError({ extension: extension.name, cause }));
      }
    }
  }

  /**
   * The result of an `activate` that ran to its end: nothing is reported running if the host closed
   * meanwhile. Roll-backs await (their `deactivate` calls can change what a survivor holds), so
   * the last check of every survivor and the merge run together with no `await` between them.
   */
  async #result(progress: Progress): Promise<ActivationResult> {
    const { failed, skipped, lateDeactivationErrors } = progress;
    let changed = changedExtensions(progress.contributed);

    while (changed.size > 0 && !this.#isClosed()) {
      await this.#rollBackChanged({ changed, progress });
      changed = changedExtensions(progress.contributed);
    }

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

    // One merge for every survivor: a collision throws here and leaves none of them merged.
    const contributions = mergeContributions(progress.contributed);

    this.#activated.forEach(({ name }) => this.#enter({ extension: name, to: 'merged' }));
    this.#state = 'active';

    return {
      contributions,
      active: this.#activated.map((extension) => extension.name),
      settings: settingInfos({ extensions: this.#activated, values: this.#settings }),
      failed,
      skipped,
      lateDeactivationErrors,
    };
  }

  /**
   * The snapshot of `contributions`, which is all the host merges from here on. Throws an
   * `ExtensionUndeclaredError` when they hold a tool, hook, work kind, event or notice the
   * manifest does not declare. `activate` had finished, so the extension may hold resources: it is deactivated
   * first (its error kept in `errors`), unlike one whose `activate` threw.
   */
  async #holdToManifest(params: {
    extension: Extension;
    contributions: Contributions;
    errors: unknown[];
  }): Promise<ContributionSnapshot> {
    const { extension, contributions, errors } = params;

    try {
      return snapshotContributions({ manifest: extension.manifest, contributions });
    } catch (caughtError) {
      await this.#stopLate({ extension, errors });
      throw caughtError;
    }
  }

  /** Ends an extension's emit capability and its per-extension services, for good; one that never started has none. */
  #disarm(extension: string): void {
    this.#emitters.get(extension)?.disarm();
    this.#services.disarm(extension);
  }

  /**
   * Moves an extension along the state table; entering a final state ends its emit capability and
   * services, so cleanup runs on every path in. The table refuses a move it does not list.
   */
  #enter(params: { extension: string; to: Exclude<ExtensionState, 'verified'> }): void {
    this.#states.move(params);

    if (isFinalState(params.to)) this.#disarm(params.extension);
  }

  /**
   * The extension as a per-extension service sees it: one object per extension, whose
   * `contributedTools` holds the checked names only while the extension is merged: empty before
   * the merge that checks collisions passed, and after any stop, roll-back or failure.
   */
  #consumerOf(extension: Extension): ServiceConsumer {
    const known = this.#consumers.get(extension.name);

    if (known) return known;

    const consumer: ServiceConsumer = {
      name: extension.name,
      manifest: extension.manifest,
      contributedTools: () => this.#states.contributedTools(extension.name),
    };

    this.#consumers.set(extension.name, consumer);

    return consumer;
  }

  /** Deactivates an extension the host stopped without `deactivate()` knowing it; an error is kept, never thrown. */
  async #stopLate(params: { extension: Extension; errors: unknown[] }): Promise<void> {
    this.#disarm(params.extension.name);

    try {
      await params.extension.deactivate?.();
    } catch (caughtError) {
      params.errors.push(caughtError);
    }
  }

  /**
   * A service the host supplied or an activated extension provided, for the app composing the
   * run. Throws if none did, or if it is a per-extension service (`hostServiceFor`): the app
   * holds no manifest, so it has no scope to read.
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
    // Before any `deactivate` runs: a stopping extension cannot emit, and neither can one still activating.
    this.#emitters.forEach((emitter) => emitter.disarm());
    this.#services.disarmAll();
    // One that is still activating moves when its step ends; it is neither verified nor merged yet.
    this.#activated.forEach(({ name }) => this.#enter({ extension: name, to: 'stopped' }));

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

  /**
   * Why an extension does not activate, if it does not: a dependency that did not, code that is
   * not trusted, or a required service nobody offers it.
   */
  async #skipped(params: {
    extension: Extension;
    unavailable: ReadonlySet<string>;
    readable: ReadonlySet<string>;
  }): Promise<SkippedExtension | undefined> {
    const { extension, unavailable, readable } = params;
    const skip = { extension: extension.name } as const;

    if (extension.dependsOn.some((name) => unavailable.has(name))) {
      return { ...skip, reason: 'dependency' };
    }

    if (!(await this.#isTrustedToRun(extension))) return { ...skip, reason: 'untrusted' };

    const missing = this.#services.unreadable({
      extension: this.#consumerOf(extension),
      required: extension.manifest.services.requires,
      readable,
    });

    return missing.length === 0 ? undefined : { ...skip, reason: 'service', missing };
  }

  async #isTrustedToRun(extension: Extension): Promise<boolean> {
    // Only a declared builtin skips the gate: any other origin value is code to trust first.
    if (extension.origin === undefined || extension.origin === 'builtin') return true;

    return (await this.#options.isTrusted?.(extension)) === true;
  }
}
