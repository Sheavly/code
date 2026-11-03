import { z } from 'zod';
import { apiKeySchema, requestPolicySchema } from '../http/adapter-config.validator.js';
import { MIN_THINKING_BUDGET } from '../anthropic-messages/messages.constants.js';
import { defineMessagesAdapter } from '../anthropic-messages/messages.helper.js';

/**
 * `baseUrl` accepts any of these, including the portal's endpoint pasted as-is:
 *   - https://<resource>.services.ai.azure.com/anthropic
 *   - https://<resource>.services.ai.azure.com/anthropic/v1
 *   - https://<resource>.services.ai.azure.com/anthropic/v1/messages
 */
const foundryEndpoint = z.url().transform((raw) => {
  const url = new URL(raw);
  const path = url.pathname
    .replace(/\/+$/, '')
    .replace(/\/messages$/, '')
    .replace(/\/v1$/, '');

  return `${url.origin}${path}/v1`;
});

/** Claude on Azure AI Foundry. `deployment` is your deployment name (sent as the model). */
export const azureAnthropicAdapter = defineMessagesAdapter({
  kind: 'azure-anthropic',
  description: 'Anthropic Messages API on Azure AI Foundry (Claude)',
  configSchema: z
    .object({
      apiKey: apiKeySchema,
      baseUrl: foundryEndpoint,
      deployment: z.string().min(1),
      maxTokens: z.number().int().positive(),
      thinkingBudget: z.number().int().min(MIN_THINKING_BUDGET).optional(),
      request: requestPolicySchema,
    })
    .refine(
      (config) => config.thinkingBudget === undefined || config.thinkingBudget < config.maxTokens,
      { message: 'thinkingBudget must be less than maxTokens', path: ['thinkingBudget'] },
    ),
  toEndpoint: (config) => ({
    baseUrl: config.baseUrl,
    model: config.deployment,
    headers: { 'x-api-key': config.apiKey },
  }),
});
