import type { ServiceConsumer } from '../extension/extension.types.js';
import { defineService, hostServiceFor } from '../extension/extension.utils.js';
import { fakeExtension } from './extension.fake.js';
import type { FakeExtensionFields } from './extension-fake.types.js';

/** The key of the per-extension service `fakeScopeFactory` supplies. */
export const FAKE_SCOPE = defineService<{ owner: string; token: number }>('scope');

/**
 * A per-extension service for host tests: records what the host asked it to build (`built`) and
 * for whom it was disarmed (`disarmed`), and hands each extension `{ owner, token }`.
 */
export function fakeScopeFactory() {
  const built: ServiceConsumer[] = [];
  const disarmed: string[] = [];
  const service = hostServiceFor({
    key: FAKE_SCOPE,
    grants: ['scope:use'],
    create: (extension) => {
      built.push(extension);

      return {
        value: { owner: extension.name, token: built.length },
        disarm: () => void disarmed.push(extension.name),
      };
    },
  });

  return { service, built, disarmed };
}

/** An extension named `one` that requires the fake scope and reads it in `activate` unless `fields` says else. */
export function fakeScopeReader(fields: Partial<FakeExtensionFields> = {}) {
  return fakeExtension({
    name: 'one',
    requires: [FAKE_SCOPE.name],
    activate: ({ services }) => (services.get(FAKE_SCOPE), {}),
    ...fields,
  });
}
