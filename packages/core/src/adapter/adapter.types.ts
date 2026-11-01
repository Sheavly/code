import type { z } from 'zod';
import type { Provider } from '../provider/provider.types.js';

/** Things adapters need from the outside world. Injected so tests can pass a fake `fetch`. */
export type AdapterDeps = {
  fetch: typeof fetch;
};

/**
 * An adapter turns validated config into a Provider.
 * Adding a new backend = writing one of these and calling `registry.register(...)`.
 */
export type Adapter<TSchema extends z.ZodType = z.ZodType> = {
  kind: string;
  description: string;
  configSchema: TSchema;
  create: (params: { config: z.infer<TSchema>; deps: AdapterDeps }) => Provider;
};
