import type { HostService, ServiceKey } from '@sheavly/extension/extension/extension.types';
import { hostServiceFor } from '@sheavly/extension/extension/extension.utils';
import { ScopeGuard } from './scope-guard.service.js';

/**
 * A run service built per extension: the host calls `build` once for each extension that reads
 * `key`, with the guard that holds that extension's grants and is switched off when the host
 * stops it. `grants` is what a manifest may declare for the service. `build` returns the scope
 * and must route every method through `guard.check(grant)`; it returns `undefined` when the run has
 * nothing to give (no output store), so the service reads as not provided while its grants stay
 * known to the manifests that ask for them.
 */
export function scopedService<TService>(params: {
  key: ServiceKey<TService>;
  grants: readonly string[];
  build: (guard: ScopeGuard) => TService | undefined;
}): HostService {
  const { key, grants, build } = params;

  return hostServiceFor({
    key,
    grants,
    create: (extension) => {
      const guard = new ScopeGuard({ extension, service: key.name });
      const value = build(guard);

      return value === undefined ? undefined : { value, disarm: () => guard.disarm() };
    },
  });
}
