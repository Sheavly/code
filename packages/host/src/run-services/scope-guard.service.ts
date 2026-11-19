import { requireGrant } from '@sheavly/extension/extension/grants.utils';
import type { ServiceConsumer } from '@sheavly/extension/extension/extension.types';
import { ScopeDeactivatedError } from '@sheavly/extension/errors/scopes.errors';

/**
 * What every scoped run service of one extension shares: the grants its manifest declared (read
 * once, when the service is built), the check each method makes, and the switch the host throws
 * when it stops the extension. After `disarm`, every `check` throws and what the scope had
 * subscribed to is stopped, so a scope an extension kept holds nothing live.
 */
export class ScopeGuard {
  readonly #extension: string;
  readonly #service: string;
  readonly #grants: readonly string[];
  readonly #contributedTools: () => readonly string[];
  readonly #stops = new Set<() => void>();
  #armed = true;

  constructor(params: { extension: ServiceConsumer; service: string }) {
    const { extension, service } = params;

    this.#extension = extension.name;
    this.#service = service;
    this.#grants = [...(extension.manifest.grants ?? [])];
    this.#contributedTools = () => extension.contributedTools();
  }

  /**
   * The names of the tools the extension contributes, as the host recorded and checked them: empty
   * while `activate` runs and once the extension is stopped. Read live on every call.
   */
  get contributedTools(): readonly string[] {
    return this.#contributedTools();
  }

  /** The name of the extension this scope was built for. */
  get extension(): string {
    return this.#extension;
  }

  /** Throws `ScopeDeactivatedError` after `disarm`, `ExtensionUndeclaredError` for a grant not declared. */
  check(grant: string): void {
    if (!this.#armed) {
      throw new ScopeDeactivatedError({ extension: this.#extension, service: this.#service });
    }

    requireGrant({ extension: this.#extension, grants: this.#grants, grant });
  }

  /** Remembers `stop` so `disarm` runs it; the returned function runs it once, now. */
  track(stop: () => void): () => void {
    this.#stops.add(stop);

    return () => {
      if (!this.#stops.delete(stop)) return;

      stop();
    };
  }

  /** Switches the scope off for good and stops everything it tracked. Does not throw. */
  disarm(): void {
    this.#armed = false;

    for (const stop of this.#stops) stop();

    this.#stops.clear();
  }
}
