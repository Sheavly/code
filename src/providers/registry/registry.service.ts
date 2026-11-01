import { z } from 'zod';
import type { Adapter, AdapterDeps } from '@sheavly/core/adapter/adapter.types';
import type { Provider } from '@sheavly/core/provider/provider.types';
import { AdapterError } from '../errors/providers.errors.js';

export class AdapterRegistry {
  private readonly adapters = new Map<string, Adapter>();

  constructor(private readonly deps: AdapterDeps = { fetch: globalThis.fetch }) {}

  register(adapter: Adapter): this {
    if (this.adapters.has(adapter.kind)) {
      throw new AdapterError({
        reason: 'duplicate',
        kind: adapter.kind,
        message: `Adapter already registered: ${adapter.kind}`,
      });
    }

    this.adapters.set(adapter.kind, adapter);

    return this;
  }

  kinds(): string[] {
    return [...this.adapters.keys()];
  }

  /** Validates `config` with the adapter's zod schema and builds a Provider. */
  create(kind: string, config: unknown): Provider {
    const adapter = this.adapters.get(kind);

    if (!adapter) {
      throw new AdapterError({
        reason: 'unknown',
        kind,
        message: `Unknown adapter: ${kind} (available: ${this.kinds().join(', ') || 'none'})`,
      });
    }

    const parsed = adapter.configSchema.safeParse(config);

    if (!parsed.success) {
      throw new AdapterError({
        reason: 'invalid_config',
        kind,
        message: `Invalid config for ${kind}:\n${z.prettifyError(parsed.error)}`,
        cause: parsed.error,
      });
    }

    return adapter.create({ config: parsed.data, deps: this.deps });
  }
}
