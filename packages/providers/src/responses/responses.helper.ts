import type { z } from 'zod';
import { defineAdapter } from '@sheavly/core/adapter/adapter.utils';
import type { Adapter } from '@sheavly/core/adapter/adapter.types';
import type { Provider } from '@sheavly/core/provider/provider.types';
import { formatHarnessNotice } from '@sheavly/core/notice/notice.utils';
import type {
  ResponsesAdapterConfig,
  ResponsesEndpoint,
  ResponsesProviderConfig,
} from './responses.types.js';
import { toInputItems } from './input.utils.js';
import { sendRequest } from '../http/request.helper.js';
import { readResponsesReply } from './responses-stream.helper.js';

/** A Provider for any backend that speaks the OpenAI Responses API. */
export function createResponsesProvider(config: ResponsesProviderConfig): Provider {
  const { endpoint } = config;
  const reasoning = config.reasoning ?? true;
  /** Encrypted reasoning is only valid for the backend + model that produced it. */
  const source = `responses:${endpoint.baseUrl}#${endpoint.model}`;
  const reasoningSource = reasoning ? source : undefined;

  return {
    async *stream({ instructions, messages, notices = [], tools, signal, mode }) {
      const url = new URL(`${endpoint.baseUrl}/responses`);

      for (const [key, value] of Object.entries(endpoint.query ?? {})) {
        url.searchParams.set(key, value);
      }

      const response = await sendRequest({
        api: 'Responses API',
        fetch: config.fetch,
        url,
        policy: config.request,
        signal,
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...endpoint.headers },
          body: JSON.stringify({
            model: endpoint.model,
            // The Responses API's system prompt; with `store: false` it is sent every call.
            ...(instructions ? { instructions } : {}),
            input: [
              ...messages.flatMap((message) => toInputItems({ message, reasoningSource })),
              ...notices.map((notice) => ({ role: 'user', content: formatHarnessNotice(notice) })),
            ],
            tools: tools.map((tool) => ({
              type: 'function',
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
            })),
            stream: true,
            store: false,
            ...(reasoning ? { include: ['reasoning.encrypted_content'] } : {}),
            ...(mode && { reasoning: { effort: mode === 'extreme' ? 'xhigh' : mode } }),
          }),
        },
      });

      // sendRequest guarantees a body for a started stream.
      yield* readResponsesReply({
        body: response.body as ReadableStream<Uint8Array>,
        reasoningSource,
        signal,
      });
    },
  };
}

/**
 * An adapter for a Responses backend. The backend only maps its validated config to an endpoint
 * (`toEndpoint`, pure); the protocol, streaming and reasoning are shared.
 */
export function defineResponsesAdapter<TSchema extends z.ZodType<ResponsesAdapterConfig>>(params: {
  kind: string;
  description: string;
  configSchema: TSchema;
  remoteField?: string;
  toEndpoint: (config: z.infer<TSchema>) => ResponsesEndpoint;
}): Adapter<TSchema> {
  const { toEndpoint, ...adapter } = params;

  return defineAdapter({
    ...adapter,
    create: ({ config, deps }) =>
      createResponsesProvider({
        endpoint: toEndpoint(config),
        reasoning: config.reasoning,
        request: config.request,
        fetch: deps.fetch,
      }),
  });
}
