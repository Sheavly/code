import type { HostService, ServiceKey } from '@sheavly/extension/extension/extension.types';
import { hostServiceFor } from '@sheavly/extension/extension/extension.utils';
import type { GrantedService } from '@sheavly/extension/run-services/run-service-grants.types';
import { grantsOfService } from '@sheavly/extension/run-services/run-service-grants.utils';
import { ScopeGuard } from './scope-guard.service.js';

/**
 * A run service built per extension: the host calls `build` once for each extension that reads
 * `key`, with the guard that holds that extension's grants and is switched off when the host
 * stops it. What a manifest may declare for the service is derived from `RUN_SERVICE_GRANTS` under
 * `service`, which must be `key.name`. `build` returns the scope and must route every method
 * through `guard.enter(member)`; it returns `undefined` when the run has nothing to give (no
 * output store), so the service reads as not provided while its grants stay known to the
 * manifests that ask for them.
 */
export function scopedService<TService, TName extends GrantedService>(params: {
  key: ServiceKey<TService>;
  service: TName;
  build: (guard: ScopeGuard<TName>) => TService | undefined;
}): HostService {
  const { key, service, build } = params;

  return hostServiceFor({
    key,
    grants: grantsOfService(service),
    create: (extension) => {
      const guard = new ScopeGuard({ extension, service });
      const value = build(guard);

      return value === undefined ? undefined : { value, disarm: () => guard.disarm() };
    },
  });
}
