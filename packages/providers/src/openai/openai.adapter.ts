import { z } from 'zod';
import {
  apiKeySchema,
  baseUrlSchema,
  explicitCacheSchema,
  reasoningSchema,
  requestPolicySchema,
} from '../http/adapter-config.validator.js';
import { defineResponsesAdapter } from '../responses/responses.helper.js';
import { OPENAI_BASE_URL } from './openai.constants.js';

/** OpenAI directly. `model` is required: which model to run is the caller's choice. */
export const openaiAdapter = defineResponsesAdapter({
  kind: 'openai',
  description: 'OpenAI Responses API',
  remoteField: 'model',
  configSchema: z.object({
    apiKey: apiKeySchema,
    model: z.string().min(1).meta({
      title: 'Model',
      description: 'What OpenAI calls the model, for example gpt-6.1',
    }),
    baseUrl: baseUrlSchema.default(OPENAI_BASE_URL),
    reasoning: reasoningSchema.default(true),
    explicitCache: explicitCacheSchema.default(true),
    request: requestPolicySchema,
  }),
  toEndpoint: (config) => ({
    baseUrl: config.baseUrl,
    model: config.model,
    headers: { authorization: `Bearer ${config.apiKey}` },
  }),
});
