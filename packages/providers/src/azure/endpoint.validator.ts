import { z } from 'zod';

export const azureApiVersionSchema = z
  .string()
  .regex(
    /^(v1|preview|\d{4}-\d{2}-\d{2}(-preview)?)$/,
    'Expected v1, preview, or a date like 2025-04-01-preview',
  )
  .meta({ title: 'API version', description: 'Only when the endpoint does not carry one' });

/** Accepts a base or portal Target URI, but never routes one protocol through another. */
export function azureEndpointSchema(params: { operation: 'responses' | 'chat/completions' }) {
  const { operation } = params;
  const suffix = operation === 'responses' ? /\/responses$/ : /\/chat\/completions$/;

  return z
    .url()
    .pipe(
      z
        .string()
        .transform((raw) => new URL(raw))
        .refine(
          (url) => {
            const path = url.pathname.replace(/\/+$/, '');

            return operation === 'responses'
              ? !path.endsWith('/chat/completions')
              : !path.endsWith('/responses');
          },
          {
            message: `This endpoint uses a different protocol. Select the Azure ${operation === 'responses' ? 'Chat Completions' : 'Responses'} adapter.`,
          },
        )
        .transform((url): { url: string; apiVersion?: string | undefined } => {
          return {
            url: `${url.origin}${url.pathname}`.replace(/\/+$/, '').replace(suffix, ''),
            apiVersion: url.searchParams.get('api-version') ?? undefined,
          };
        })
        .pipe(z.object({ url: z.url(), apiVersion: azureApiVersionSchema.optional() })),
    )
    .meta({
      title: 'Endpoint',
      description: 'The Azure portal Target URI, or the API base address',
    });
}
