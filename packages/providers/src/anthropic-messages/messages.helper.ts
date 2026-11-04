import type { z } from 'zod';
import { defineAdapter } from '@sheavly/core/adapter/adapter.utils';
import type { Adapter } from '@sheavly/core/adapter/adapter.types';
import type { StopReason } from '@sheavly/core/message/message.types';
import type { Provider } from '@sheavly/core/provider/provider.types';
import { ModelApiError } from '../errors/providers.errors.js';
import { sendRequest } from '../http/request.helper.js';
import { readServerSentEvents } from '../http/sse.utils.js';
import { ANTHROPIC_VERSION, MESSAGES_API } from './messages.constants.js';
import { createMessagesReader } from './events.utils.js';
import { toMessagesApiMessages } from './input.utils.js';
import type {
  MessagesAdapterConfig,
  MessagesEndpoint,
  MessagesProviderConfig,
} from './messages.types.js';
import { messagesEventSchema } from './messages.validator.js';

/** A Provider for any backend that speaks the Anthropic Messages API. */
export function createMessagesProvider(config: MessagesProviderConfig): Provider {
  const { endpoint, maxTokens, thinkingBudget } = config;
  /** Thinking signatures are only valid for the backend + model that produced them. */
  const reasoningSource =
    thinkingBudget === undefined ? undefined : `messages:${endpoint.baseUrl}#${endpoint.model}`;

  return {
    async *stream({ instructions, messages, tools, signal }) {
      const response = await sendRequest({
        api: MESSAGES_API,
        fetch: config.fetch,
        url: new URL(`${endpoint.baseUrl}/messages`),
        policy: config.request,
        signal,
        init: {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'anthropic-version': ANTHROPIC_VERSION,
            ...endpoint.headers,
          },
          body: JSON.stringify({
            model: endpoint.model,
            max_tokens: maxTokens,
            ...(instructions ? { system: instructions } : {}),
            messages: toMessagesApiMessages({ messages, reasoningSource }),
            ...(tools.length > 0 && {
              tools: tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.inputSchema,
              })),
            }),
            ...(thinkingBudget !== undefined && {
              thinking: { type: 'enabled', budget_tokens: thinkingBudget },
            }),
            stream: true,
          }),
        },
      });
      const reader = createMessagesReader(reasoningSource);
      let stopReason: StopReason = 'end_turn';
      let ended = false;

      // `sendRequest` returns only a response that started, so it has a body.
      for await (const raw of readServerSentEvents(response.body as ReadableStream<Uint8Array>)) {
        const parsed = messagesEventSchema.safeParse(raw);

        if (!parsed.success) continue; // an event type we don't use

        const step = reader.read(parsed.data);

        if (step.stopReason) stopReason = step.stopReason;
        if (step.ended) ended = true;

        yield* step.events;
      }

      // A body cut off mid-reply (dropped connection, proxy timeout) is not a finished turn.
      if (!ended) {
        signal.throwIfAborted();
        throw new ModelApiError({
          reason: 'cut_off',
          message: `${MESSAGES_API} stream ended before message_stop`,
        });
      }

      yield { type: 'done', stopReason };
    },
  };
}

/**
 * An adapter for a Messages backend. The backend only maps its validated config to an endpoint
 * (`toEndpoint`, pure); the protocol, streaming and thinking are shared.
 */
export function defineMessagesAdapter<TSchema extends z.ZodType<MessagesAdapterConfig>>(params: {
  kind: string;
  description: string;
  configSchema: TSchema;
  remoteField?: string;
  toEndpoint: (config: z.infer<TSchema>) => MessagesEndpoint;
}): Adapter<TSchema> {
  const { toEndpoint, ...adapter } = params;

  return defineAdapter({
    ...adapter,
    create: ({ config, deps }) =>
      createMessagesProvider({
        endpoint: toEndpoint(config),
        maxTokens: config.maxTokens,
        thinkingBudget: config.thinkingBudget,
        request: config.request,
        fetch: deps.fetch,
      }),
  });
}
