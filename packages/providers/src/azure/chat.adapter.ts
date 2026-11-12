import { z } from 'zod';
import { apiKeySchema, requestPolicySchema } from '../http/adapter-config.validator.js';
import { defineChatCompletionsAdapter } from '../chat-completions/chat-completions.helper.js';
import { azureEndpointSchema, azureApiVersionSchema } from './endpoint.validator.js';

/** Azure Foundry models using the portal's /models/chat/completions endpoint. */
export const azureChatAdapter = defineChatCompletionsAdapter({
  kind: 'azure-chat',
  description: 'Azure Chat Completions (AI Foundry models, including DeepSeek)',
  remoteField: 'deployment',
  configSchema: z.object({
    apiKey: apiKeySchema,
    baseUrl: azureEndpointSchema({ operation: 'chat/completions' }),
    deployment: z
      .string()
      .min(1)
      .meta({ title: 'Deployment', description: 'The deployment name from the Azure portal' }),
    apiVersion: azureApiVersionSchema.optional(),
    maxTokens: z.number().int().positive().optional().meta({
      title: 'Maximum output tokens',
      description:
        'Per reply, including thinking. Leave empty for a model-aware default (384000 for recognized DeepSeek names); an unrecognized deployment sends no limit and the server decides.',
    }),
    replayReasoning: z.boolean().default(false).meta({
      title: 'Replay plain reasoning',
      description:
        'Preserve reasoning_content for models such as DeepSeek, never encrypted Responses items',
    }),
    thinkingMode: z.enum(['enabled', 'disabled']).optional().meta({
      title: 'Thinking mode',
      description: 'Optional model-specific setting; omit for the deployment default',
    }),
    effortProfile: z.enum(['openai', 'deepseek']).default('openai').meta({
      title: 'Effort profile',
      description: 'Explicit effort mapping: OpenAI uses xhigh for extreme; DeepSeek uses max',
    }),
    request: requestPolicySchema,
  }),
  toEndpoint: (config) => {
    const url = new URL(`${config.baseUrl.url}/chat/completions`);
    const apiVersion = config.apiVersion ?? config.baseUrl.apiVersion;

    if (apiVersion) url.searchParams.set('api-version', apiVersion);

    return {
      url: url.href,
      model: config.deployment,
      headers: { 'api-key': config.apiKey, 'extra-parameters': 'pass-through' },
    };
  },
});
