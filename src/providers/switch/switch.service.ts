import type { StreamEvent } from '@sheavly/core/message/message.types';
import type { Provider, ProviderRequest } from '@sheavly/core/provider/provider.types';

/**
 * A Provider that forwards to whichever named provider is currently active,
 * so the model backend can be swapped while an agent is running.
 *
 * Swaps take effect on the next model call. A stream already in progress
 * finishes on the provider it started with.
 */
export class ProviderSwitch implements Provider {
  private readonly providers = new Map<string, Provider>();
  private activeName: string | undefined;

  /** Adds (or replaces) a named provider. The first one added becomes active. */
  add(name: string, provider: Provider): this {
    this.providers.set(name, provider);
    this.activeName ??= name;

    return this;
  }

  use(name: string): void {
    if (!this.providers.has(name)) {
      throw new Error(
        `Unknown provider: ${name} (available: ${this.names().join(', ') || 'none'})`,
      );
    }

    this.activeName = name;
  }

  get active(): string | undefined {
    return this.activeName;
  }

  names(): string[] {
    return [...this.providers.keys()];
  }

  stream(request: ProviderRequest): AsyncIterable<StreamEvent> {
    const provider = this.activeName ? this.providers.get(this.activeName) : undefined;

    if (!provider) throw new Error('No active provider');

    return provider.stream(request);
  }
}
