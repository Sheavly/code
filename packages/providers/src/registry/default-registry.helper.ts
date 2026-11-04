import type { AdapterDeps } from '@sheavly/core/adapter/adapter.types';
import { azureAnthropicAdapter } from '../azure/anthropic.adapter.js';
import { azureOpenaiAdapter } from '../azure/openai.adapter.js';
import { openaiAdapter } from '../openai/openai.adapter.js';
import { AdapterRegistry } from './registry.service.js';

/** Registry pre-loaded with the built-in adapters. Register more on the returned instance. */
export function createDefaultRegistry(deps?: AdapterDeps): AdapterRegistry {
  return new AdapterRegistry(deps)
    .register(openaiAdapter)
    .register(azureOpenaiAdapter)
    .register(azureAnthropicAdapter);
}
