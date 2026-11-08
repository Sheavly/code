import type { Provider } from '@sheavly/core/provider/provider.types';
import type { Model } from '@sheavly/protocol/model/model.types';

/** Captures the model's configured rates. Switching models cannot reprice an earlier call. */
export function pricedProvider(params: { provider: Provider; model: Model }): Provider {
  const { provider, model } = params;
  const price = model.pricing ? { ...model.pricing } : undefined;

  return {
    async *stream(request) {
      for await (const event of provider.stream(request)) {
        if (event.type !== 'done') {
          yield event;
          continue;
        }

        const usage = { ...event.usage, tokens: event.usage?.tokens ?? null, modelId: model.id };
        const { tokens } = usage;

        if (tokens && price) {
          usage.estimatedCostUsd =
            ((tokens.inputTokens - tokens.cacheReadTokens - tokens.cacheWriteTokens) * price.input +
              tokens.outputTokens * price.output +
              tokens.cacheReadTokens * price.cacheRead +
              tokens.cacheWriteTokens * price.cacheWrite) /
            1_000_000;
        }

        yield { ...event, usage };
      }
    },
    // A wrapper keeps what it does not change, whatever order it is stacked in.
    get contextWindow() {
      return provider.contextWindow;
    },
  };
}
