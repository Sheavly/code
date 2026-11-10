import { z } from 'zod';
import {
  apiKeySchema,
  explicitCacheSchema,
  reasoningSchema,
  requestPolicySchema,
} from '../http/adapter-config.validator.js';
import { defineResponsesAdapter } from '../responses/responses.helper.js';
import { azureEndpointSchema, azureApiVersionSchema } from './endpoint.validator.js';

/**
 * `baseUrl` accepts any of these, including the portal's "Target URI" pasted as-is:
 *   - https://<resource>.openai.azure.com/openai/v1
 *   - https://<resource>.cognitiveservices.azure.com/openai
 *   - https://<resource>.cognitiveservices.azure.com/openai/responses?api-version=2025-04-01-preview
 * An `api-version` in the URL is used unless `apiVersion` is set explicitly.
 */
const azureEndpoint = azureEndpointSchema({ operation: 'responses' });

/** Models on Azure that speak the OpenAI Responses API. `deployment` is sent as the model. */
export const azureOpenaiAdapter = defineResponsesAdapter({
  kind: 'azure-openai',
  description: 'Azure Responses API (Azure OpenAI and AI Foundry: GPT, DeepSeek, ...)',
  remoteField: 'deployment',
  configSchema: z.object({
    apiKey: apiKeySchema,
    baseUrl: azureEndpoint,
    deployment: z.string().min(1).meta({
      title: 'Deployment',
      description: 'The deployment’s name in the Azure portal',
    }),
    apiVersion: azureApiVersionSchema.optional(),
    reasoning: reasoningSchema.default(true),
    explicitCache: explicitCacheSchema.default(true),
    request: requestPolicySchema,
  }),
  toEndpoint: (config) => {
    const apiVersion = config.apiVersion ?? config.baseUrl.apiVersion;

    return {
      baseUrl: config.baseUrl.url,
      model: config.deployment,
      headers: { 'api-key': config.apiKey },
      ...(apiVersion ? { query: { 'api-version': apiVersion } } : {}),
    };
  },
});
