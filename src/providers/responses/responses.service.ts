import type { AdapterDeps } from '@sheavly/core/adapter/adapter.types';
import type { StopReason } from '@sheavly/core/message/message.types';
import type { Provider } from '@sheavly/core/provider/provider.types';
import type { BearerResponsesConfig, ResponsesConfig } from './responses.types.js';
import { handleEvent, responsesEventSchema, toInputItems } from './responses.utils.js';
import { readServerSentEvents } from './sse.utils.js';

/** A Provider for any backend that speaks the OpenAI Responses API. */
export function createResponsesProvider(config: ResponsesConfig): Provider {
  const reasoning = config.reasoning ?? true;
  /** Encrypted reasoning is only valid for the backend + model that produced it. */
  const source = `responses:${config.baseUrl}#${config.model}`;
  const reasoningSource = reasoning ? source : undefined;

  return {
    async *stream({ instructions, messages, tools, signal }) {
      const url = new URL(`${config.baseUrl}/responses`);

      for (const [key, value] of Object.entries(config.query ?? {})) {
        url.searchParams.set(key, value);
      }

      const response = await config.fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...config.headers },
        body: JSON.stringify({
          model: config.model,
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
        throw new Error(`Responses API error ${response.status}: ${await response.text()}`);
      }

      let stopReason: StopReason = 'end_turn';

      for await (const raw of readServerSentEvents(response.body)) {
        const parsed = responsesEventSchema.safeParse(raw);

        if (!parsed.success) continue; // an event type we don't use

        const step = handleEvent({ event: parsed.data, reasoningSource });

        if (step.stopReason) stopReason = step.stopReason;

        if (step.event) yield step.event;
      }

      yield { type: 'done', stopReason };
    },
  };
}

/** A Responses backend that takes a Bearer API key: OpenAI and OpenAI-compatible gateways. */
export function createBearerResponsesProvider(params: {
  config: BearerResponsesConfig;
  deps: AdapterDeps;
}): Provider {
  const { config, deps } = params;

  return createResponsesProvider({
    baseUrl: config.baseUrl,
    model: config.model,
    headers: { authorization: `Bearer ${config.apiKey}` },
    reasoning: config.reasoning,
    fetch: deps.fetch,
  });
}
