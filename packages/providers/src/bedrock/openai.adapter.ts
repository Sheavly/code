import { z } from 'zod';
import {
  explicitCacheSchema,
  reasoningSchema,
  requestPolicySchema,
} from '../http/adapter-config.validator.js';
import { defineResponsesAdapter } from '../responses/responses.helper.js';
import { bedrockAuthFields, refineBedrockAuth } from './auth.validator.js';
import { bedrockAuth } from './auth.helper.js';
import { bedrockProfileSchema, bedrockRegionSchema } from './bedrock.validator.js';
import { bedrockBaseUrl } from './bedrock.utils.js';

/**
 * GPT on Amazon Bedrock, over the Responses API of `bedrock-runtime`, signed in with a Bedrock API
 * key or an IAM access key pair (`auth`). The calls are stateless (`store: false`), so nothing is
 * kept on Bedrock between turns.
 */
export const bedrockOpenaiAdapter = defineResponsesAdapter({
  kind: 'bedrock-openai',
  description: 'OpenAI Responses API on Amazon Bedrock (GPT)',
  remoteField: 'model',
  configSchema: refineBedrockAuth(
    z.object({
      ...bedrockAuthFields,
      region: bedrockRegionSchema,
      model: bedrockProfileSchema({ provider: 'openai', example: 'us.openai.gpt-6-astra' }),
      reasoning: reasoningSchema.default(true),
      explicitCache: explicitCacheSchema.default(true),
      request: requestPolicySchema,
    }),
  ),
  toEndpoint: (config) => ({
    baseUrl: bedrockBaseUrl({ region: config.region, api: 'openai' }),
    model: config.model,
    ...bedrockAuth({
      config,
      apiKeyHeaders: (apiKey) => ({ authorization: `Bearer ${apiKey}` }),
    }),
  }),
});
