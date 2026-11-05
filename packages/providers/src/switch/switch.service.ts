import type { StreamEvent } from '@sheavly/core/message/message.types';
import type { Provider, ProviderRequest } from '@sheavly/core/provider/provider.types';
import { ProviderSwitchError } from '../errors/providers.errors.js';
import type { ModelMode } from '@sheavly/protocol/model/model.types';

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
  private readonly modes = new Map<string, ModelMode>();

  /** Adds (or replaces) a named provider. The first one added becomes active. */
  add(name: string, provider: Provider): this {
    this.providers.set(name, provider);
    this.activeName ??= name;

    return this;
  }

  use(name: string): void {
    if (!this.providers.has(name)) {
      throw new ProviderSwitchError({
        reason: 'unknown',
        message: `Unknown provider: ${name} (available: ${this.names().join(', ') || 'none'})`,
      });
    }

    this.activeName = name;
  }

  get active(): string | undefined {
    return this.activeName;
  }

  get activeMode(): ModelMode | undefined {
    return this.activeName ? this.modes.get(this.activeName) : undefined;
  }

  /** Changes future calls only; a pinned provider captures its mode when pinned. */
  setMode(params: { name: string; mode: ModelMode }): void {
    if (!this.providers.has(params.name)) {
      throw new ProviderSwitchError({
        reason: 'unknown',
        message: `Unknown provider: ${params.name}`,
      });
    }

    this.modes.set(params.name, params.mode);
  }

  names(): string[] {
    return [...this.providers.keys()];
  }

  /**
   * The provider added under `key`, which stays on it whatever the switch is set to: for a run
   * pinned to one model (a sub-agent) while the main session switches around. A key is whatever
   * the caller added the provider under; a host registers a model's provider under the model's
   * id, never its display name. Throws a `ProviderSwitchError` (`unknown`) for a key that was
   * never added.
   */
  pinned(key: string): Provider {
    const provider = this.providers.get(key);

    if (!provider) {
      throw new ProviderSwitchError({
        reason: 'unknown',
        message: `Unknown provider: ${key} (available: ${this.names().join(', ') || 'none'})`,
      });
    }

    const mode = this.modes.get(key);

    if (!mode) return provider;

    return { stream: (request) => provider.stream({ ...request, mode }) };
  }

  stream(request: ProviderRequest): AsyncIterable<StreamEvent> {
    const provider = this.activeName ? this.providers.get(this.activeName) : undefined;

    if (!provider) {
      throw new ProviderSwitchError({ reason: 'none_active', message: 'No active provider' });
    }

    const mode = this.activeMode;

    return provider.stream(mode ? { ...request, mode } : request);
  }
}
