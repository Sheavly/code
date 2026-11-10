import { z } from 'zod';
import { apiKeySchema, requestPolicySchema } from '../http/adapter-config.validator.js';
import { MIN_THINKING_BUDGET } from '../anthropic-messages/messages.constants.js';
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
  configSchema: z
    .object({
      apiKey: apiKeySchema,
      baseUrl: foundryEndpoint,
      deployment: z.string().min(1).meta({
        title: 'Deployment',
        description: 'The deployment’s name in the Azure AI Foundry portal',
      }),
      maxTokens: z.number().int().positive().optional().meta({
        title: 'Max tokens',
        description:
          'Output tokens per reply, including thinking. Leave empty for a model-aware default (32768 for current Claude IDs, 8192 for unknown deployments). Explicit values must fit the deployment’s output limit.',
      }),
      thinkingMode: z.enum(['adaptive', 'enabled', 'disabled']).optional().meta({
        title: 'Thinking mode',
        description:
          'Use adaptive for models that require it, such as Sonnet 5.5. Enabled uses a fixed thinking budget; disabled turns thinking off.',
      }),
      thinkingBudget: z.number().int().min(MIN_THINKING_BUDGET).optional().meta({
        title: 'Thinking budget',
        description:
          'Only for enabled thinking: at least 1024, under max tokens. Leave empty for adaptive or disabled.',
      }),
      promptCaching: z.boolean().default(true).meta({
        title: 'Prompt caching',
        description:
          'Send cache_control so repeated turns reuse the prompt prefix. On by default; turn it off only for a deployment that rejects the field.',
      }),
      request: requestPolicySchema,
    })
    .refine(
      (config) =>
        config.thinkingBudget === undefined ||
        config.thinkingBudget <
          messagesMaxTokens({ model: config.deployment, maxTokens: config.maxTokens }),
      { message: 'thinkingBudget must be less than maxTokens', path: ['thinkingBudget'] },
    )
    .refine((config) => config.thinkingMode !== 'enabled' || config.thinkingBudget !== undefined, {
      message: 'Enabled thinking requires a thinking budget.',
      path: ['thinkingBudget'],
    })
    .refine(
      (config) =>
        config.thinkingBudget === undefined ||
        config.thinkingMode === undefined ||
        config.thinkingMode === 'enabled',
      {
        message: 'Leave thinkingBudget empty for adaptive or disabled thinking.',
        path: ['thinkingBudget'],
      },
    ),
  toEndpoint: (config) => ({
    baseUrl: config.baseUrl,
    model: config.deployment,
    headers: { 'x-api-key': config.apiKey },
  }),
});
