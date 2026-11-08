import type { Provider } from '@sheavly/core/provider/provider.types';
import type { Model } from '@sheavly/protocol/model/model.types';
import { DEFAULT_CONTEXT_WINDOW } from './context-window.constants.js';

/**
 * Gives a provider the context window of its model: the one its file sets, else the default. It
 * is captured when the provider is built, so a model switch (a different provider) changes the
 * window the agent is told and an edited file applies from the next build.
 */
export function withContextWindow(params: { provider: Provider; model: Model }): Provider {
  const { provider, model } = params;

  return {
    stream: (request) => provider.stream(request),
    contextWindow: model.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
  };
}
