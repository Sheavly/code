import { z } from 'zod';
import { DEFAULT_ADAPTER, DEFAULT_MODEL } from './harness.constants.js';

/** An empty line in `.env` (`AZURE_OPENAI_API_VERSION=`) means "not set". */
const optionalSetting = z
  .string()
  .optional()
  .transform((value) => (value === '' ? undefined : value));

/**
 * The model backend settings a host reads from the environment: `ADAPTER` picks "openai" (the
 * default) or "azure", each with its own keys. Each missing key names what to set.
 */
const providerEnvSchema = z.discriminatedUnion('ADAPTER', [
  z.object({
    ADAPTER: z.literal('openai'),
    OPENAI_API_KEY: z.string().min(1, 'Set OPENAI_API_KEY'),
    MODEL: z.string().default(DEFAULT_MODEL),
  }),
  z.object({
    ADAPTER: z.literal('azure'),
    AZURE_OPENAI_API_KEY: z.string().min(1, 'Set AZURE_OPENAI_API_KEY'),
    AZURE_OPENAI_BASE_URL: z.string().min(1, 'Set AZURE_OPENAI_BASE_URL'),
    AZURE_OPENAI_DEPLOYMENT: z.string().default(DEFAULT_MODEL),
    AZURE_OPENAI_API_VERSION: optionalSetting,
  }),
]);

/** The settings from `env`, with `ADAPTER` defaulting to the hosts' default backend. */
export function parseProviderEnv(env: Record<string, string | undefined>) {
  return providerEnvSchema.parse({ ...env, ADAPTER: env.ADAPTER ?? DEFAULT_ADAPTER });
}
