import type { ServiceConsumer, ServiceInstance } from '../extension/extension.types.js';
import type { ServiceFactory } from './extension-host.types.js';

/** Whether a `disarm` handed back something that settles later, whatever its type says. */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') && value !== null && 'then' in value
  );
}

/**
 * What per-extension service factories built, and who may switch it off. An instance is built
 * once per consuming extension (on its first read) and is disarmed once, when the consumer ends
 * or when the extension that provides the service ends, whichever comes first: a scope never
 * outlives either of them.
 */
export class ServiceInstances {
  /** What each factory built for each consumer, by consumer then service; `undefined` is a factory with nothing to give. */
  readonly #built = new Map<string, Map<string, ServiceInstance | undefined>>();
  /** The instances each provider's factories handed out, to switch off when the provider ends. */
  readonly #handedOut = new Map<string, ServiceInstance[]>();
  /** Extensions that ended, as consumer or provider: an instance built afterwards is born disarmed. */
  readonly #ended = new Set<string>();
  readonly #off = new WeakSet<ServiceInstance>();
  /** Errors thrown by a `disarm`, waiting to be reported (see `takeErrors`). */
  readonly #errors: unknown[] = [];
  #closed = false;

  /**
   * What `factory` of `service` (provided by `provider`) builds for `consumer`: built on first
   * use, then the same one. Disarmed at once when the consumer or the provider already ended.
   */
  instanceFor(params: {
    consumer: ServiceConsumer;
    service: string;
    provider: string;
    factory: ServiceFactory;
  }): ServiceInstance | undefined {
    const { consumer, service, provider, factory } = params;
    // The frozen snapshot's name, read once: the memo and the ended check use the same key.
    const { name } = consumer;
    const built = this.#built.get(name) ?? new Map<string, ServiceInstance | undefined>();

    if (built.has(service)) return built.get(service);

    const instance = factory(consumer);

    built.set(service, instance);
    this.#built.set(name, built);

    if (instance === undefined) return undefined;

    this.#handedOut.set(provider, [...(this.#handedOut.get(provider) ?? []), instance]);

    if (this.#closed || this.#ended.has(name) || this.#ended.has(provider)) {
      this.#switchOff(instance);
    }

    return instance;
  }

  /**
   * Switches off every instance built for `extension` and every one its own services handed out,
   * once; what is built afterwards for or by it is born disarmed.
   */
  end(extension: string): void {
    if (this.#ended.has(extension)) return;

    this.#ended.add(extension);

    for (const instance of this.#built.get(extension)?.values() ?? []) this.#switchOff(instance);

    for (const instance of this.#handedOut.get(extension) ?? []) this.#switchOff(instance);
  }

  /** Ends every extension, and any built from now on. For when the host closes. */
  endAll(): void {
    this.#closed = true;

    for (const extension of [...this.#built.keys(), ...this.#handedOut.keys()]) {
      this.end(extension);
    }
  }

  /**
   * What the `disarm` calls threw since the last call, handed over once: the caller reports them.
   * Ending never throws, so one instance's failure cannot leave another armed or stop the host.
   */
  takeErrors(): unknown[] {
    return this.#errors.splice(0);
  }

  /**
   * Each instance's `disarm` runs once, however many paths end its consumer and its provider. It
   * is marked off before it runs and its error is kept, never thrown, so a throwing one still
   * counts as ended. A `disarm` that returns a promise (typed `void`, but an async function
   * satisfies it) is not awaited, so a hang cannot block the stop; its rejection is kept when it
   * settles, which can be after the stop returned, and is reported by the next `takeErrors`.
   */
  #switchOff(instance: ServiceInstance | undefined): void {
    if (instance === undefined || this.#off.has(instance)) return;

    this.#off.add(instance);

    try {
      const returned: unknown = instance.disarm?.();

      // `Promise.resolve` also contains a thenable whose `then` throws or rejects.
      if (isThenable(returned)) {
        Promise.resolve(returned).catch((caughtError: unknown) => this.#errors.push(caughtError));
      }
    } catch (caughtError) {
      this.#errors.push(caughtError);
    }
  }
}
