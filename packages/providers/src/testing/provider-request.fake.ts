import type { ProviderRequest } from '@sheavly/core/provider/provider.types';

/** Test-only: a model call saying "hi" with no tools, with `overrides` on top. */
export const providerRequest = (overrides: Partial<ProviderRequest> = {}): ProviderRequest => ({
  messages: [{ role: 'user', content: 'hi' }],
  tools: [],
  signal: new AbortController().signal,
  ...overrides,
});
