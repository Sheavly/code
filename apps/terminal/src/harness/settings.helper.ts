import os from 'node:os';
import path from 'node:path';
import type { Environment } from '@sheavly/core/environment/environment.types';
import { createDefaultRegistry } from '@sheavly/providers/registry/default-registry.helper';
import { TrustStore } from '@sheavly/workspace/trust/trust.service';
import { TRUST_STORE_PATH } from './harness.constants.js';
import type { ProviderSettings } from './harness.types.js';
import { parseProviderEnv, parseRequestEnv } from './settings.validator.js';

/**
 * The model backend the terminal app runs against, from its environment (`process.env`, after
 * loading `.env`): `ADAPTER` is "openai" (the default) or "azure", each with its own keys. The
 * packages never pick one; another UI reads its own settings and builds its own provider.
 */
export function providerFromEnv(environment: Environment): ProviderSettings {
  const env = parseProviderEnv(environment);
  const request = parseRequestEnv(environment);
  const registry = createDefaultRegistry();

  if (env.ADAPTER === 'azure') {
    return {
      adapter: 'azure',
      model: env.AZURE_OPENAI_DEPLOYMENT,
      provider: registry.create('azure', {
        apiKey: env.AZURE_OPENAI_API_KEY,
        baseUrl: env.AZURE_OPENAI_BASE_URL,
        deployment: env.AZURE_OPENAI_DEPLOYMENT,
        apiVersion: env.AZURE_OPENAI_API_VERSION,
        request,
      }),
    };
  }

  return {
    adapter: 'openai',
    model: env.MODEL,
    provider: registry.create('openai', { apiKey: env.OPENAI_API_KEY, model: env.MODEL, request }),
  };
}

/**
 * The user's workspace trust store: `SHEAVLY_TRUST_FILE`, or `trusted-workspaces.json` under
 * `$XDG_CONFIG_HOME/sheavly` (default `~/.config/sheavly`). Outside every repo, so a repo can't
 * trust itself.
 */
export function trustStoreFromEnv(env: Environment): TrustStore {
  // An empty variable (a blank line in .env) counts as not set.
  const set = (value: string | undefined) => (value === '' ? undefined : value);
  const configHome = set(env.XDG_CONFIG_HOME) ?? path.join(os.homedir(), '.config');

  return new TrustStore({
    file: set(env.SHEAVLY_TRUST_FILE) ?? path.join(configHome, ...TRUST_STORE_PATH),
  });
}
