import { z } from 'zod';
import {
  apiKeySchema,
  explicitCacheSchema,
  reasoningSchema,
  requestPolicySchema,
} from '../http/adapter-config.validator.js';
import { defineResponsesAdapter } from '../responses/responses.helper.js';
import { bedrockProfileSchema, bedrockRegionSchema } from './bedrock.validator.js';
import { bedrockBaseUrl } from './bedrock.utils.js';

/**
 * GPT on Amazon Bedrock, over the Responses API of `bedrock-runtime`, with a Bedrock API key. The
 * calls are stateless (`store: false`), so nothing is kept on Bedrock between turns.
 */
export const bedrockOpenaiAdapter = defineResponsesAdapter({
  kind: 'bedrock-openai',
  description: 'OpenAI Responses API on Amazon Bedrock (GPT)',
  remoteField: 'model',
  configSchema: z.object({
    apiKey: apiKeySchema,
    region: bedrockRegionSchema,
    model: bedrockProfileSchema({ provider: 'openai', example: 'us.openai.gpt-6-astra' }),
    reasoning: reasoningSchema.default(true),
    explicitCache: explicitCacheSchema.default(true),
    request: requestPolicySchema,
  }),
  toEndpoint: (config) => ({
    baseUrl: bedrockBaseUrl({ region: config.region, api: 'openai' }),
    model: config.model,
    headers: { authorization: `Bearer ${config.apiKey}` },
  }),
});
