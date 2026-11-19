import { requireGrant } from '../extension/grants.utils.js';
import type { ServiceConsumer } from '../extension/extension.types.js';
import { defineService } from '../extension/extension.utils.js';
import { fakeExtension } from './extension.fake.js';
import type { FakeExtensionFields, GrantedScope } from './extension-fake.types.js';
import { GRANTED_GRANT } from './granted-service.constants.js';

/** The key of the service `fakeGrantedProvider` provides with `provideFor`. */
export const GRANTED = defineService<GrantedScope>('granted');

/**
 * An extension named `maker` that provides `GRANTED` per consumer and declares `GRANTED_GRANT`
 * for it. Records each consumer it built for (`built`) and each scope it disarmed (`disarmed`);
 * `use` enforces the grant over the consumer's manifest with `requireGrant` and refuses once
 * disarmed.
 */
export function fakeGrantedProvider(fields: Partial<FakeExtensionFields> = {}) {
  const built: ServiceConsumer[] = [];
  const disarmed: string[] = [];
  const extension = fakeExtension({
    name: 'maker',
    provides: [GRANTED.name],
    serviceGrants: { [GRANTED.name]: [GRANTED_GRANT] },
    activate: ({ services }) => {
      services.provideFor({
        key: GRANTED,
        create: (consumer) => {
          let off = false;

          built.push(consumer);

          return {
            value: {
              owner: consumer.name,
              token: built.length,
              use: () => {
                if (off) throw new Error('deactivated');

                requireGrant({
                  extension: consumer.name,
                  grants: consumer.manifest.grants,
                  grant: GRANTED_GRANT,
                });

                return consumer.name;
              },
            },
            disarm: () => {
              off = true;
              disarmed.push(consumer.name);
            },
          };
        },
      });

      return {};
    },
    ...fields,
  });

  return { extension, built, disarmed };
}

/** An extension named `one` that depends on `maker`, holds the grant and reads `GRANTED` in `activate`. */
export function fakeGrantedConsumer(fields: Partial<FakeExtensionFields> = {}) {
  return fakeExtension({
    name: 'one',
    dependsOn: ['maker'],
    requires: [GRANTED.name],
    grants: [GRANTED_GRANT],
    activate: ({ services }) => (services.get(GRANTED), {}),
    ...fields,
  });
}
