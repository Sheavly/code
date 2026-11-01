import { z } from 'zod';
import { defineAdapter } from '@sheavly/core/adapter/adapter.service';
import { createResponsesProvider } from '../responses/responses.service.js';
import { apiKeySchema, reasoningSchema } from './adapters.utils.js';

/**
 * `baseUrl` accepts any of these, including the portal's "Target URI" pasted as-is:
 *   - https://<resource>.openai.azure.com/openai/v1
 *   - https://<resource>.cognitiveservices.azure.com/openai
 *   - https://<resource>.cognitiveservices.azure.com/openai/responses?api-version=2025-04-01-preview
 * An `api-version` in the URL is used unless `apiVersion` is set explicitly.
 */
const azureEndpoint = z.url().transform((raw) => {
  const url = new URL(raw);

  return {
    url: `${url.origin}${url.pathname}`.replace(/\/+$/, '').replace(/\/responses$/, ''),
    apiVersion: url.searchParams.get('api-version') ?? undefined,
  };
});

const azureApiVersion = z
  .string()
  .regex(
    /^(v1|preview|\d{4}-\d{2}-\d{2}(-preview)?)$/,
    'Expected v1, preview, or a date like 2025-04-01-preview',
  );

/** Azure OpenAI. `deployment` is your deployment name (sent as the model). */
export const azureAdapter = defineAdapter({
  kind: 'azure',
  description: 'Azure OpenAI Responses API',
  configSchema: z.object({
    apiKey: apiKeySchema,
    baseUrl: azureEndpoint,
    deployment: z.string().min(1),
    apiVersion: azureApiVersion.optional(),
    reasoning: reasoningSchema.default(true),
  }),
  create: ({ config, deps }) => {
    const apiVersion = config.apiVersion ?? config.baseUrl.apiVersion;

    return createResponsesProvider({
      baseUrl: config.baseUrl.url,
      model: config.deployment,
      headers: { 'api-key': config.apiKey },
      ...(apiVersion ? { query: { 'api-version': apiVersion } } : {}),
      reasoning: config.reasoning,
      fetch: deps.fetch,
    });
  },
});
