import { ContributionCollisionError, MissingServiceError } from '../errors/extension.errors.js';
import { HOST_PROVIDER } from '../extension/extension.constants.js';
import type {
  HostService,
  ServiceConsumer,
  ServiceInstance,
  ServiceKey,
  Services,
} from '../extension/extension.types.js';
import { assertDeclared } from './declaration.utils.js';

/** A service by its provider: one shared value, or a host factory built per extension. */
type ServiceEntry =
  | { provider: string; value: unknown }
  | {
      provider: string;
      factory: (extension: ServiceConsumer) => ServiceInstance | undefined;
    };

/** How a provider reads in a collision message. */
function describeProvider(provider: string): string {
  return provider === HOST_PROVIDER ? 'the host' : provider;
}

/**
 * The typed services extensions share. Each extension gets its own view (`viewFor`): it can add
 * services under its own name and read only those of the extensions it may (itself and what it
 * depends on) plus the services the host supplies, so a read never depends on activation luck.
 */
export class ServiceRegistry {
  readonly #entries = new Map<string, ServiceEntry>();
  /**
   * What each factory built for each extension, by extension then service: built once, on first
   * read. `undefined` records a factory that had nothing to give.
   */
  readonly #instances = new Map<string, Map<string, ServiceInstance | undefined>>();
  /** Extensions whose instances are disarmed: one built afterwards is born disarmed. */
  readonly #disarmed = new Set<string>();
  #closed = false;

  /** Records the services the host supplies; throws a collision when two share a name. */
  constructor(hostServices: readonly HostService[] = []) {
    for (const service of hostServices) {
      if ('forExtension' in service) {
        this.#assertFree({ name: service.name, extension: HOST_PROVIDER });
        this.#entries.set(service.name, {
          provider: HOST_PROVIDER,
          factory: service.forExtension,
        });
      } else {
        this.#provide({
          extension: HOST_PROVIDER,
          key: { name: service.name },
          value: service.value,
        });
      }
    }
  }

  /**
   * The registry as `extension` sees it; `readable` are the extension names it may read from.
   * Its manifest's `services` is what it declared: `get` and `find` throw an
   * `ExtensionUndeclaredError` for a name not in `requires` or `optional`, and `provide` for one
   * not in `provides`. The host supplies run services too, and they are held to the same list. A
   * host factory service is built for the extension on its first declared read, never for
   * `provide`, and the same instance comes back on every later read.
   */
  viewFor(params: { extension: ServiceConsumer; readable: ReadonlySet<string> }): Services {
    const { extension, readable } = params;
    const declared = extension.manifest.services;
    const readableNames = [...declared.requires, ...declared.optional];

    return {
      provide: (key, value) => {
        assertDeclared({
          extension: extension.name,
          use: 'service provide',
          name: key.name,
          allowed: declared.provides,
          declareIn: 'services.provides',
        });
        this.#provide({ extension: extension.name, key, value });
      },
      get: (key) => {
        assertDeclared({
          extension: extension.name,
          use: 'service get',
          name: key.name,
          allowed: readableNames,
          declareIn: 'services.requires',
        });

        return this.#get({ extension, readable, key });
      },
      find: (key) => {
        assertDeclared({
          extension: extension.name,
          use: 'service find',
          name: key.name,
          allowed: readableNames,
          declareIn: 'services.optional',
        });

        return this.#find({ extension, readable, key })?.value;
      },
    };
  }

  /**
   * The names in `required` that an extension could not read now: nobody has provided them, or an
   * extension it does not depend on did (`readable` are the extension names it may read from).
   * The host supplies its services before anything activates and the dependencies have
   * activated, so what is missing now stays missing. A host factory service counts only when it
   * builds something for `extension`: the instance is the one a later `get` returns (built once,
   * memoised), and a factory with nothing to give reads as not provided.
   */
  unreadable(params: {
    extension: ServiceConsumer;
    required: readonly string[];
    readable: ReadonlySet<string>;
  }): string[] {
    const { extension, required, readable } = params;

    return required.filter((name) => {
      const entry = this.#entries.get(name);

      if (entry === undefined) return true;

      if ('factory' in entry) {
        return (
          this.#instanceFor({ extension, service: name, factory: entry.factory }) === undefined
        );
      }

      return entry.provider !== HOST_PROVIDER && !readable.has(entry.provider);
    });
  }

  /**
   * A service the host supplied or any extension provided, for the app that composes the run (it
   * is no extension, so it depends on none). Throws when nobody provided it.
   */
  read<TService>(key: ServiceKey<TService>): TService {
    const entry = this.#entries.get(key.name);

    if (!entry) {
      throw new MissingServiceError({
        service: key.name,
        reader: 'the app',
        problem: 'no extension provided it: is its extension in the run?',
      });
    }

    if ('factory' in entry) {
      throw new MissingServiceError({
        service: key.name,
        reader: 'the app',
        problem: 'it is built per extension, so only an extension can read it',
      });
    }

    return entry.value as TService;
  }

  /**
   * Switches off what the factories built for `extension`, once: afterwards each instance's
   * `disarm` has run and one built later is born disarmed. The host calls it wherever it disarms
   * the extension's emitter.
   */
  disarm(extension: string): void {
    if (this.#disarmed.has(extension)) return;

    this.#disarmed.add(extension);

    for (const instance of this.#instances.get(extension)?.values() ?? []) instance?.disarm?.();
  }

  /** Disarms every extension's instances, and any built from now on. For when the host closes. */
  disarmAll(): void {
    this.#closed = true;

    for (const extension of this.#instances.keys()) this.disarm(extension);
  }

  /**
   * Drops every service `extension` provided. The host calls it when that extension's `activate`
   * failed after providing some, so nothing reads a half-built extension's services.
   */
  forget(extension: string): void {
    for (const [name, entry] of this.#entries) {
      if (entry.provider === extension) this.#entries.delete(name);
    }
  }

  #provide<TService>(params: {
    extension: string;
    key: ServiceKey<TService>;
    value: TService;
  }): void {
    const { extension, key, value } = params;

    this.#assertFree({ name: key.name, extension });
    this.#entries.set(key.name, { value, provider: extension });
  }

  #assertFree(params: { name: string; extension: string }): void {
    const taken = this.#entries.get(params.name);

    if (!taken) return;

    throw new ContributionCollisionError({
      contribution: 'service',
      contributionName: params.name,
      first: describeProvider(taken.provider),
      second: describeProvider(params.extension),
    });
  }

  /** What the factory of `service` built for `extension`: built on first use, then the same one. */
  #instanceFor(params: {
    extension: ServiceConsumer;
    service: string;
    factory: (extension: ServiceConsumer) => ServiceInstance | undefined;
  }): ServiceInstance | undefined {
    const { extension, service, factory } = params;
    const built =
      this.#instances.get(extension.name) ?? new Map<string, ServiceInstance | undefined>();

    if (built.has(service)) return built.get(service);

    const instance = factory(extension);

    built.set(service, instance);
    this.#instances.set(extension.name, built);

    if (this.#closed || this.#disarmed.has(extension.name)) instance?.disarm?.();

    return instance;
  }

  #get<TService>(params: {
    extension: ServiceConsumer;
    readable: ReadonlySet<string>;
    key: ServiceKey<TService>;
  }): TService {
    const { extension, key } = params;
    const found = this.#find(params);

    if (found === undefined) {
      throw new MissingServiceError({
        service: key.name,
        reader: extension.name,
        problem: 'no extension provides it (yet): depend on the extension that does',
      });
    }

    return found.value;
  }

  /**
   * The service under `key` if it is provided; throws when its provider is not readable. A
   * provider that has not activated yet is not seen, so for a non-dependency the answer depends
   * on activation order.
   */
  #find<TService>(params: {
    extension: ServiceConsumer;
    readable: ReadonlySet<string>;
    key: ServiceKey<TService>;
  }): { value: TService } | undefined {
    const { extension, readable, key } = params;
    const entry = this.#entries.get(key.name);

    if (!entry) return undefined;

    if (entry.provider !== HOST_PROVIDER && !readable.has(entry.provider)) {
      throw new MissingServiceError({
        service: key.name,
        reader: extension.name,
        problem: `it is provided by ${entry.provider}, which ${extension.name} does not depend on: add it to dependsOn`,
      });
    }

    if ('factory' in entry) {
      const instance = this.#instanceFor({
        extension,
        service: key.name,
        factory: entry.factory,
      });

      return instance && { value: instance.value as TService };
    }

    return { value: entry.value as TService };
  }
}
