import { z } from 'zod';
import { apiKeySchema, requestPolicySchema } from '../http/adapter-config.validator.js';
import {
  claudeThinkingFields,
  refineClaudeThinking,
} from '../anthropic-messages/claude-config.validator.js';
import { defineMessagesAdapter } from '../anthropic-messages/messages.helper.js';
import { messagesMaxTokens } from '../anthropic-messages/output-tokens.utils.js';

/**
 * `baseUrl` accepts any of these, including the portal's endpoint pasted as-is:
 *   - https://<resource>.services.ai.azure.com/anthropic
 *   - https://<resource>.services.ai.azure.com/anthropic/v1
 *   - https://<resource>.services.ai.azure.com/anthropic/v1/messages
 */
const foundryEndpoint = z
  .url()
  .transform((raw) => {
    const url = new URL(raw);
    const path = url.pathname
      .replace(/\/+$/, '')
      .replace(/\/messages$/, '')
      .replace(/\/v1$/, '');

    return `${url.origin}${path}/v1`;
  })
  .meta({
    title: 'Endpoint',
    description: 'The resource’s address from the Azure AI Foundry portal, pasted as it is',
  });

/** Claude on Azure AI Foundry. `deployment` is your deployment name (sent as the model). */
export const azureAnthropicAdapter = defineMessagesAdapter({
  kind: 'azure-anthropic',
  description: 'Anthropic Messages API on Azure AI Foundry (Claude)',
  remoteField: 'deployment',
  configSchema: refineClaudeThinking({
    schema: z.object({
      apiKey: apiKeySchema,
      baseUrl: foundryEndpoint,
      deployment: z.string().min(1).meta({
        title: 'Deployment',
        description: 'The deployment’s name in the Azure AI Foundry portal',
      }),
      maxTokens: z.number().int().positive().optional().meta({
        title: 'Max tokens',
        description:
          'Output tokens per reply, including thinking. Leave empty for a model-aware default (128000, the documented limit, for current Claude IDs; 8192 for unknown deployments). Explicit values must fit the deployment’s output limit.',
      }),
      ...claudeThinkingFields,
      request: requestPolicySchema,
    }),
    maxTokensOf: (config) =>
      messagesMaxTokens({ model: config.deployment, maxTokens: config.maxTokens }),
  }),
  toEndpoint: (config) => ({
    baseUrl: config.baseUrl,
    model: config.deployment,
    headers: { 'x-api-key': config.apiKey },
  }),
});
