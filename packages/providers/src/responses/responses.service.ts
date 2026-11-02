import type { z } from 'zod';
import { defineAdapter } from '@sheavly/core/adapter/adapter.service';
import type { Adapter } from '@sheavly/core/adapter/adapter.types';
import type { StopReason } from '@sheavly/core/message/message.types';
import type { Provider } from '@sheavly/core/provider/provider.types';
import type {
  ResponsesAdapterConfig,
  ResponsesEndpoint,
  ResponsesProviderConfig,
} from './responses.types.js';
import { handleEvent, responsesEventSchema } from './events.utils.js';
import { toInputItems } from './input.utils.js';
import { ResponsesApiError } from '../errors/providers.errors.js';
import { readServerSentEvents } from './sse.utils.js';

/** A Provider for any backend that speaks the OpenAI Responses API. */
export function createResponsesProvider(config: ResponsesProviderConfig): Provider {
  const { endpoint } = config;
  const reasoning = config.reasoning ?? true;
  /** Encrypted reasoning is only valid for the backend + model that produced it. */
  const source = `responses:${endpoint.baseUrl}#${endpoint.model}`;
  const reasoningSource = reasoning ? source : undefined;

  return {
    async *stream({ instructions, messages, tools, signal }) {
      const url = new URL(`${endpoint.baseUrl}/responses`);

      for (const [key, value] of Object.entries(endpoint.query ?? {})) {
        url.searchParams.set(key, value);
      }

      const response = await config.fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...endpoint.headers },
        body: JSON.stringify({
          model: endpoint.model,
          // The Responses API's system prompt; with `store: false` it is sent every call.
          ...(instructions ? { instructions } : {}),
          input: messages.flatMap((message) => toInputItems({ message, reasoningSource })),
          tools: tools.map((tool) => ({
            type: 'function',
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          })),
          stream: true,
          store: false,
          ...(reasoning ? { include: ['reasoning.encrypted_content'] } : {}),
        }),
        signal,
      });

      if (!response.ok || !response.body) {
        throw new ResponsesApiError({
          reason: 'http',
          status: response.status,
          message: `Responses API error ${response.status}: ${await response.text()}`,
        });
      }

      let stopReason: StopReason = 'end_turn';
      let ended = false;

      for await (const raw of readServerSentEvents(response.body)) {
        const parsed = responsesEventSchema.safeParse(raw);

        if (!parsed.success) continue; // an event type we don't use

        const step = handleEvent({ event: parsed.data, reasoningSource });

        if (step.stopReason) stopReason = step.stopReason;
        if (step.ended) ended = true;

        if (step.event) yield step.event;
      }

      // A body cut off mid-reply (dropped connection, proxy timeout) is not a finished turn.
      if (!ended) {
        signal.throwIfAborted();
        throw new ResponsesApiError({
          reason: 'cut_off',
          message: 'Responses stream ended before response.completed',
        });
      }

      yield { type: 'done', stopReason };
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
  toEndpoint: (config: z.infer<TSchema>) => ResponsesEndpoint;
}): Adapter<TSchema> {
  const { toEndpoint, ...adapter } = params;

  return defineAdapter({
    ...adapter,
    create: ({ config, deps }) =>
      createResponsesProvider({
        endpoint: toEndpoint(config),
        reasoning: config.reasoning,
        fetch: deps.fetch,
      }),
  });
}
