import type { z } from 'zod';
import type { Provider } from '../provider/provider.types.js';

/** Things adapters need from the outside world. Injected so tests can pass a fake `fetch`. */
export type AdapterDeps = {
  fetch: typeof fetch;
};

/**
 * An adapter turns validated config into a Provider.
 * Adding a new backend = writing one of these and calling `registry.register(...)`.
 *
 * `configSchema` is everything the adapter takes: what a person chooses, a secret, and what the
 * host fills in. `remoteField`, when the adapter has one, names the field of the config that holds
 * what the provider calls the model (`model`, `deployment`), so a UI can show it next to the
 * model's own display name without knowing each adapter's vocabulary.
 */
export type Adapter<TSchema extends z.ZodType = z.ZodType> = {
  kind: string;
  description: string;
  configSchema: TSchema;
  remoteField?: string;
  create: (params: { config: z.infer<TSchema>; deps: AdapterDeps }) => Provider;
};
