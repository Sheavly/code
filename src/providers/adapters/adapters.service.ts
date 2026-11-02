import { AdapterRegistry } from '../registry/registry.service.js';
import type { AdapterDeps } from '@sheavly/core/adapter/adapter.types';
import { azureAdapter } from './azure.adapter.js';
import { openaiAdapter } from './openai.adapter.js';

/** Registry pre-loaded with the built-in adapters. Register more on the returned instance. */
export function createDefaultRegistry(deps?: AdapterDeps): AdapterRegistry {
  return new AdapterRegistry(deps).register(openaiAdapter).register(azureAdapter);
}
