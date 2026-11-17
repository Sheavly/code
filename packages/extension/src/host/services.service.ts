import { ContributionCollisionError, MissingServiceError } from '../errors/extension.errors.js';
import { HOST_PROVIDER } from '../extension/extension.constants.js';
import type { HostService, ServiceKey, Services } from '../extension/extension.types.js';
import type { ExtensionManifest } from '../manifest/manifest.types.js';
import { assertDeclared } from './declaration.utils.js';

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
  readonly #entries = new Map<string, { value: unknown; provider: string }>();

  /** Records the services the host supplies; throws a collision when two share a name. */
  constructor(hostServices: readonly HostService[] = []) {
    for (const { name, value } of hostServices) {
      this.#provide({ extension: HOST_PROVIDER, key: { name }, value });
    }
  }

  /**
   * The registry as `extension` sees it; `readable` are the extension names it may read from.
   * `declared` is the services its manifest lists: `get` and `find` throw an
   * `ExtensionUndeclaredError` for a name not in `requires` or `optional`, and `provide` for one
   * not in `provides`. The host supplies run services too, and they are held to the same list.
   */
  viewFor(params: {
    extension: string;
    readable: ReadonlySet<string>;
    declared: ExtensionManifest['services'];
  }): Services {
    const { extension, readable, declared } = params;
    const readableNames = [...declared.requires, ...declared.optional];

    return {
      provide: (key, value) => {
        assertDeclared({
          extension,
          use: 'service provide',
          name: key.name,
          allowed: declared.provides,
          declareIn: 'services.provides',
        });
        this.#provide({ extension, key, value });
      },
      get: (key) => {
        assertDeclared({
          extension,
          use: 'service get',
          name: key.name,
          allowed: readableNames,
          declareIn: 'services.requires',
        });

        return this.#get({ extension, readable, key });
      },
      find: (key) => {
        assertDeclared({
          extension,
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
   * activated, so what is missing now stays missing.
   */
  unreadable(params: { required: readonly string[]; readable: ReadonlySet<string> }): string[] {
    const { required, readable } = params;

    return required.filter((name) => {
      const entry = this.#entries.get(name);

      return (
        entry === undefined || (entry.provider !== HOST_PROVIDER && !readable.has(entry.provider))
      );
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

    return entry.value as TService;
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
    const taken = this.#entries.get(key.name);

    if (taken) {
      throw new ContributionCollisionError({
        contribution: 'service',
        contributionName: key.name,
        first: describeProvider(taken.provider),
        second: describeProvider(extension),
      });
    }

    this.#entries.set(key.name, { value, provider: extension });
  }

  #get<TService>(params: {
    extension: string;
    readable: ReadonlySet<string>;
    key: ServiceKey<TService>;
  }): TService {
    const { extension, key } = params;
    const found = this.#find(params);

    if (found === undefined) {
      throw new MissingServiceError({
        service: key.name,
        reader: extension,
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
    extension: string;
    readable: ReadonlySet<string>;
    key: ServiceKey<TService>;
  }): { value: TService } | undefined {
    const { extension, readable, key } = params;
    const entry = this.#entries.get(key.name);

    if (!entry) return undefined;

    if (entry.provider !== HOST_PROVIDER && !readable.has(entry.provider)) {
      throw new MissingServiceError({
        service: key.name,
        reader: extension,
        problem: `it is provided by ${entry.provider}, which ${extension} does not depend on: add it to dependsOn`,
      });
    }

    return { value: entry.value as TService };
  }
}
