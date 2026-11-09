import type { z } from 'zod';
import { defineAdapter } from '@sheavly/core/adapter/adapter.utils';
import type { Adapter } from '@sheavly/core/adapter/adapter.types';
import type { Provider } from '@sheavly/core/provider/provider.types';
import { sendRequest } from '../http/request.helper.js';
import { ANTHROPIC_VERSION, MESSAGES_API } from './messages.constants.js';
import { toMessagesApiMessages, withNotice } from './input.utils.js';
import type {
  MessagesAdapterConfig,
  MessagesEndpoint,
  MessagesProviderConfig,
} from './messages.types.js';
import { thinkingFor } from './thinking.utils.js';
import { messagesPrefix } from './prefix.utils.js';
import { messagesMaxTokens } from './output-tokens.utils.js';
import { readMessagesReply } from './messages-stream.helper.js';

/** A Provider for any backend that speaks the Anthropic Messages API. */
export function createMessagesProvider(config: MessagesProviderConfig): Provider {
  const { endpoint } = config;
  const maxTokens = messagesMaxTokens({ model: endpoint.model, maxTokens: config.maxTokens });
  const thinking = thinkingFor(config);

  return {
    async *stream({ instructions, messages, notice, tools, signal, mode }) {
      // Effort enables adaptive thinking; preserve its signed blocks across tool calls as well.
      const reasoningSource =
        mode || thinking?.type === 'enabled' || thinking?.type === 'adaptive'
          ? `messages:${endpoint.baseUrl}#${endpoint.model}`
          : undefined;
      const apiTools = tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      }));
      const apiMessages = toMessagesApiMessages({
        messages,
        reasoningSource,
        instructions,
        tools: apiTools,
      });

      const sent = withNotice({ messages: apiMessages, notice });
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
            messages: sent,
            ...(tools.length > 0 && {
              tools: apiTools,
            }),
            ...(mode
              ? {
                  thinking: { type: 'adaptive' },
                  output_config: { effort: mode === 'extreme' ? 'max' : mode },
                }
              : thinking && { thinking }),
            stream: true,
          }),
        },
      });

      // sendRequest guarantees a body for a started stream. The API binds a thinking signature to
      // everything sent before it, the notice included, and refuses it (400) once that content is
      // missing. The notice is gone next turn, so the prefix covers what was sent: it then no
      // longer matches, and the thinking is dropped instead of replayed.
      yield* readMessagesReply({
        body: response.body as ReadableStream<Uint8Array>,
        reasoningSource,
        prefix: messagesPrefix({ instructions, tools: apiTools, messages: sent }),
        signal,
      });
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
        thinkingMode: config.thinkingMode,
        request: config.request,
        fetch: deps.fetch,
      }),
  });
}
