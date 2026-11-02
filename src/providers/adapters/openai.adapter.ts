import { z } from 'zod';
import { defineResponsesAdapter } from '../responses/responses.service.js';
import { DEFAULT_MODEL, OPENAI_BASE_URL } from './adapters.constants.js';
import { apiKeySchema, baseUrlSchema, reasoningSchema } from './adapters.utils.js';

/** OpenAI directly. This is the default backend (GPT-6.1 Sol). */
export const openaiAdapter = defineResponsesAdapter({
  kind: 'openai',
  description: 'OpenAI Responses API (GPT-6.1 family)',
  configSchema: z.object({
    apiKey: apiKeySchema,
    model: z.string().default(DEFAULT_MODEL),
    baseUrl: baseUrlSchema.default(OPENAI_BASE_URL),
    reasoning: reasoningSchema.default(true),
  }),
  toEndpoint: (config) => ({
    baseUrl: config.baseUrl,
    model: config.model,
    headers: { authorization: `Bearer ${config.apiKey}` },
  }),
});
