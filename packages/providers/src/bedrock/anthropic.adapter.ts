import { z } from 'zod';
import { apiKeySchema, requestPolicySchema } from '../http/adapter-config.validator.js';
import {
  claudeThinkingFields,
  refineClaudeThinking,
} from '../anthropic-messages/claude-config.validator.js';
import { defineMessagesAdapter } from '../anthropic-messages/messages.helper.js';
import { bedrockProfileSchema, bedrockRegionSchema } from './bedrock.validator.js';
import { bedrockBaseUrl } from './bedrock.utils.js';

/** Claude on Amazon Bedrock, over the Messages API of `bedrock-runtime`, with a Bedrock API key. */
export const bedrockAnthropicAdapter = defineMessagesAdapter({
  kind: 'bedrock-anthropic',
  description: 'Anthropic Messages API on Amazon Bedrock (Claude)',
  remoteField: 'model',
  configSchema: refineClaudeThinking({
    schema: z.object({
      apiKey: apiKeySchema,
      region: bedrockRegionSchema,
      model: bedrockProfileSchema({
        provider: 'anthropic',
        example: 'us.anthropic.claude-sonnet-5-5',
      }),
      maxTokens: z.number().int().positive().meta({
        title: 'Max tokens',
        description:
          'Output tokens per reply, including thinking. Required: Bedrock holds back the input plus this many tokens of your quota for every call, so set what you need, not the model’s maximum.',
      }),
      ...claudeThinkingFields,
      request: requestPolicySchema,
    }),
    maxTokensOf: (config) => config.maxTokens,
  }),
  toEndpoint: (config) => ({
    baseUrl: bedrockBaseUrl({ region: config.region, api: 'anthropic' }),
    model: config.model,
    headers: { 'x-api-key': config.apiKey },
  }),
});
