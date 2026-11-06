import { z } from 'zod';
import {
  apiKeySchema,
  reasoningSchema,
  requestPolicySchema,
} from '../http/adapter-config.validator.js';
import { defineResponsesAdapter } from '../responses/responses.helper.js';

/**
 * `baseUrl` accepts any of these, including the portal's "Target URI" pasted as-is:
 *   - https://<resource>.openai.azure.com/openai/v1
 *   - https://<resource>.cognitiveservices.azure.com/openai
 *   - https://<resource>.cognitiveservices.azure.com/openai/responses?api-version=2025-04-01-preview
 * An `api-version` in the URL is used unless `apiVersion` is set explicitly.
 */
const azureEndpoint = z
  .url()
  .transform((raw) => {
    const url = new URL(raw);

    return {
      url: `${url.origin}${url.pathname}`.replace(/\/+$/, '').replace(/\/responses$/, ''),
      apiVersion: url.searchParams.get('api-version') ?? undefined,
    };
  })
  .meta({
    title: 'Endpoint',
    description:
      'The resource’s address from the Azure portal; the “Target URI” can be pasted as it is',
  });

const azureApiVersion = z
  .string()
  .regex(
    /^(v1|preview|\d{4}-\d{2}-\d{2}(-preview)?)$/,
    'Expected v1, preview, or a date like 2025-04-01-preview',
  )
  .meta({ title: 'API version', description: 'Only when the endpoint doesn’t carry one' });

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
    apiVersion: azureApiVersion.optional(),
    reasoning: reasoningSchema.default(true),
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
