import type { Provider } from '@sheavly/core/provider/provider.types';
import type { ScopeGuard } from './scope-guard.service.js';

/**
 * The run's provider for one extension: it forwards everything, and `stream`, the model call on
 * the app's credentials, needs `model:call`. `contextWindow` is read live, because a provider
 * that can switch model answers for the one its next call goes to.
 */
export class ModelScope implements Provider {
  readonly #guard: ScopeGuard;
  readonly #provider: Provider;

  constructor(params: { guard: ScopeGuard; provider: Provider }) {
    this.#guard = params.guard;
    this.#provider = params.provider;
    Object.freeze(this);
  }

  stream: Provider['stream'] = (request) => {
    this.#guard.check('model:call');

    return this.#provider.stream(request);
  };

  get contextWindow(): number | undefined {
    return this.#provider.contextWindow;
  }
}
