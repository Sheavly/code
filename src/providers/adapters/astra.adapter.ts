import { z } from 'zod';
import { defineAdapter } from '@sheavly/core/adapter/adapter.service';
import { createResponsesProvider } from '../responses/responses.service.js';
import { ASTRA_BASE_URL } from './adapters.constants.js';
import { apiKeySchema, baseUrlSchema, reasoningSchema } from './adapters.utils.js';

/**
 * AstraAPI gateway (OpenAI-compatible). Opt-in, never the default. Model ids look like `openai/gpt-6-luna`.
 * Reasoning persistence is off by default: the gateway routes to non-OpenAI models too,
 * and its support for `include: ["reasoning.encrypted_content"]` is unverified.
 */
export const astraAdapter = defineAdapter({
  kind: 'astra',
  description: 'AstraAPI gateway (OpenAI-compatible Responses API)',
  configSchema: z.object({
    apiKey: apiKeySchema,
    model: z.string().min(1),
    baseUrl: baseUrlSchema.default(ASTRA_BASE_URL),
    reasoning: reasoningSchema.default(false),
  }),
  create: ({ config, deps }) =>
    createResponsesProvider({
      baseUrl: config.baseUrl,
      model: config.model,
      headers: { authorization: `Bearer ${config.apiKey}` },
      reasoning: config.reasoning,
      fetch: deps.fetch,
    }),
});
