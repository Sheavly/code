import os from 'node:os';
import path from 'node:path';
import type { Environment } from '@sheavly/core/environment/environment.types';
import { createDefaultRegistry } from '@sheavly/providers/registry/default-registry.helper';
import type { AdapterRegistry } from '@sheavly/providers/registry/registry.service';
import { ProviderSwitch } from '@sheavly/providers/switch/switch.service';
import { DocumentFile } from '@sheavly/storage/document-file/document-file.service';
import { TrustStore } from '@sheavly/workspace/trust/trust.service';
import { TRUST_STORE_PATH } from './harness.constants.js';
import type { ModelChoice } from '@sheavly/protocol/server/server.types';
import type { ModelSwitch, ProviderSettings } from './harness.types.js';
import { parseModelsEnv } from './models.validator.js';
import { modelIdOfEnvName } from './model-id.utils.js';
import { parseProviderEnv, parseRequestEnv } from './settings.validator.js';

/**
 * The model the backend runs against, from its environment (`process.env`, after
 * loading `.env`). `MODELS` lists several by name, each with its own keys (`modelsFromEnv`), and
 * the run starts on the first; otherwise `ADAPTER` is "openai" (the default) or "azure-openai", each
 * with its own keys. The packages never pick one.
 */
export function providerFromEnv(environment: Environment): ProviderSettings {
  const request = parseRequestEnv(environment);
  const registry = createDefaultRegistry();
  const models = modelsFromEnv({ environment, registry, request });

  if (models) {
    const [first] = models.choices as [ModelChoice, ...ModelChoice[]];

    return {
      id: first.id,
      adapter: first.adapter,
      model: first.model,
      provider: models.switch,
      models,
    };
  }

  const env = parseProviderEnv(environment);

  if (env.ADAPTER === 'azure-openai') {
    return {
      id: modelIdOfEnvName(env.AZURE_OPENAI_DEPLOYMENT),
      adapter: 'azure-openai',
      model: env.AZURE_OPENAI_DEPLOYMENT,
      provider: registry.create('azure-openai', {
        apiKey: env.AZURE_OPENAI_API_KEY,
        baseUrl: env.AZURE_OPENAI_BASE_URL,
        deployment: env.AZURE_OPENAI_DEPLOYMENT,
        apiVersion: env.AZURE_OPENAI_API_VERSION,
        request,
      }),
    };
  }

  return {
    id: modelIdOfEnvName(env.MODEL),
    adapter: 'openai',
    model: env.MODEL,
    provider: registry.create('openai', { apiKey: env.OPENAI_API_KEY, model: env.MODEL, request }),
  };
}

/**
 * The models `MODELS` names (`parseModelsEnv`), each built from its own keys, behind one switch
 * that starts on the first. Undefined when `MODELS` is unset.
 */
function modelsFromEnv(params: {
  environment: Environment;
  registry: AdapterRegistry;
  request: ReturnType<typeof parseRequestEnv>;
}): ModelSwitch | undefined {
  const { environment, registry, request } = params;
  const parsed = parseModelsEnv(environment);

  if (!parsed) return undefined;

  const models: ModelSwitch = { switch: new ProviderSwitch(), choices: [] };

  for (const { name, settings } of parsed) {
    const shared = {
      apiKey: settings.API_KEY,
      baseUrl: settings.BASE_URL,
      deployment: settings.DEPLOYMENT,
      request,
    };
    const config =
      settings.ADAPTER === 'azure-openai'
        ? { ...shared, apiVersion: settings.API_VERSION, reasoning: settings.REASONING }
        : { ...shared, maxTokens: settings.MAX_TOKENS, thinkingBudget: settings.THINKING_BUDGET };

    // The switch is keyed by id, the one thing that names a model; the name is only its label.
    const id = modelIdOfEnvName(name);

    models.switch.add(id, registry.create(settings.ADAPTER, config));
    models.choices.push({ id, name, adapter: settings.ADAPTER, model: settings.DEPLOYMENT });
  }

  return models;
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
    persistence: new DocumentFile({
      file: set(env.SHEAVLY_TRUST_FILE) ?? path.join(configHome, ...TRUST_STORE_PATH),
    }),
  });
}
