import { fakeFetchSequence } from '@sheavly/testing/fetch/fake-fetch.fake';
import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
import type { ChatProviderConfig } from '../chat-completions/chat-completions.types.js';
import { createChatCompletionsProvider } from '../chat-completions/chat-completions.helper.js';
import { TEST_REQUEST } from './request.constants.js';

/** No network: each call consumes one scripted SSE response and captures the rendered request. */
export function chatTransport(params: {
  responses: object[][];
  config?: Partial<Omit<ChatProviderConfig, 'fetch' | 'request'>>;
}) {
  const transport = fakeFetchSequence({ responses: params.responses, complete: false });
  const endpoint = {
    url: 'https://chat.test/models/chat/completions?api-version=2024-05-01-preview',
    model: 'custom-deployment',
    headers: { 'api-key': 'fake-key' },
  };
  const provider = createChatCompletionsProvider({
    endpoint,
    request: TEST_REQUEST,
    fetch: transport.fetch,
    ...params.config,
  });

  return { ...transport, provider };
}

export function chatCall(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    instructions: 'Stable instructions',
    messages: [{ role: 'user', content: 'Inspect both items' }],
    tools: [{ name: 'inspect', description: 'Inspect an item', inputSchema: { type: 'object' } }],
    signal: new AbortController().signal,
    ...overrides,
  };
}

export function chatFrame(params: { delta?: object; finish?: string | null } = {}) {
  return {
    choices: [{ index: 0, delta: params.delta ?? {}, finish_reason: params.finish ?? null }],
  };
}
