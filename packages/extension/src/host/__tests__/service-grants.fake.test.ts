import { describe, expect, it } from 'vitest';
import { ExtensionUndeclaredError } from '../../errors/manifest.errors.js';
import { requireGrant } from '../../extension/grants.utils.js';
import { defineService } from '../../extension/extension.utils.js';
import { fakeExtension } from '../../testing/extension.fake.js';
import { GRANTED_GRANT } from '../../testing/granted-service.constants.js';
import { fakeGrantedProvider, GRANTED } from '../../testing/granted-service.fake.js';
import { assertServiceEnforcesGrants } from '../../testing/service-grants.fake.js';

type Notes = { read: () => string; write: () => string };

const NOTES = defineService<Notes>('notes');
const READ = 'notes:read';
const WRITE = 'notes:write';

/**
 * A provider of `NOTES` that declares two grants. `checks` says which grant each method
 * enforces: a method set to `null` enforces nothing, one set to the other grant enforces the wrong one.
 */
function notesProvider(checks: { read: string | null; write: string | null }) {
  return fakeExtension({
    name: 'notes-maker',
    provides: [NOTES.name],
    serviceGrants: { [NOTES.name]: [READ, WRITE] },
    activate: ({ services }) => {
      services.provideFor({
        key: NOTES,
        create: (consumer) => {
          const enforce = (grant: string | null) => {
            if (grant === null) return;

            requireGrant({
              extension: consumer.name,
              grants: consumer.manifest.grants,
              grant,
            });
          };

          return {
            value: {
              read: () => (enforce(checks.read), 'text'),
              write: () => (enforce(checks.write), 'done'),
            },
          };
        },
      });

      return {};
    },
  });
}

const calls = { [READ]: (scope: Notes) => scope.read(), [WRITE]: (scope: Notes) => scope.write() };

describe('assertServiceEnforcesGrants accepts a provider that enforces every declared grant', () => {
  it('passes when each call refuses without its grant and is not refused with it', async () => {
    await expect(
      assertServiceEnforcesGrants({
        provider: notesProvider({ read: READ, write: WRITE }),
        service: NOTES,
        calls,
      }),
    ).resolves.toBeUndefined();
  });

  it('passes for the package granted fake with one grant', async () => {
    await expect(
      assertServiceEnforcesGrants({
        provider: fakeGrantedProvider().extension,
        service: GRANTED,
        calls: { [GRANTED_GRANT]: (scope) => scope.use() },
      }),
    ).resolves.toBeUndefined();
  });

  it('lets a call throw something else once the grant is held, and awaits an async call', async () => {
    await expect(
      assertServiceEnforcesGrants({
        provider: notesProvider({ read: READ, write: WRITE }),
        service: NOTES,
        calls: {
          [READ]: async (scope) => {
            scope.read();

            throw new TypeError('the work itself failed');
          },
          [WRITE]: (scope) => scope.write(),
        },
      }),
    ).resolves.toBeUndefined();
  });
});

describe('assertServiceEnforcesGrants rejects a provider that does not enforce what it declares', () => {
  it('fails a provider whose method checks no grant', async () => {
    await expect(
      assertServiceEnforcesGrants({
        provider: notesProvider({ read: READ, write: null }),
        service: NOTES,
        calls,
      }),
    ).rejects.toThrow(/did not refuse a consumer without the grant notes:write/);
  });

  it('fails a provider whose method checks the wrong grant', async () => {
    await expect(
      assertServiceEnforcesGrants({
        provider: notesProvider({ read: WRITE, write: WRITE }),
        service: NOTES,
        calls,
      }),
    ).rejects.toThrow(/did not refuse a consumer without the grant notes:read/);
  });

  it('fails a call that throws something other than the undeclared-grant error without the grant', async () => {
    await expect(
      assertServiceEnforcesGrants({
        provider: notesProvider({ read: READ, write: WRITE }),
        service: NOTES,
        calls: {
          [READ]: () => {
            throw new TypeError('not the grant error');
          },
          [WRITE]: (scope) => scope.write(),
        },
      }),
    ).rejects.toThrow(/did not refuse a consumer without the grant notes:read: TypeError/);
  });

  it('fails a provider that refuses a consumer even though it holds the grant', async () => {
    const stingy = fakeExtension({
      name: 'notes-maker',
      provides: [NOTES.name],
      serviceGrants: { [NOTES.name]: [READ] },
      activate: ({ services }) => {
        services.provideFor({
          key: NOTES,
          create: (consumer) => ({
            value: {
              read: () => {
                throw new ExtensionUndeclaredError({
                  extension: consumer.name,
                  use: 'grant',
                  undeclared: READ,
                  declareIn: 'grants',
                });
              },
              write: () => 'done',
            },
          }),
        });

        return {};
      },
    });

    await expect(
      assertServiceEnforcesGrants({
        provider: stingy,
        service: NOTES,
        calls: { [READ]: (scope) => scope.read() },
      }),
    ).rejects.toThrow(/refused a consumer that holds notes:read/);
  });
});

describe('assertServiceEnforcesGrants fails a call list that covers less or more than the manifest', () => {
  it('fails when a declared grant has no call', async () => {
    await expect(
      assertServiceEnforcesGrants({
        provider: notesProvider({ read: READ, write: WRITE }),
        service: NOTES,
        calls: { [READ]: (scope) => scope.read() },
      }),
    ).rejects.toThrow(/missing \[notes:write\], not declared \[\]/);
  });

  it('fails when calls names a grant the provider does not declare', async () => {
    await expect(
      assertServiceEnforcesGrants({
        provider: notesProvider({ read: READ, write: WRITE }),
        service: NOTES,
        calls: { ...calls, 'notes:delete': (scope) => scope.write() },
      }),
    ).rejects.toThrow(/missing \[\], not declared \[notes:delete\]/);
  });

  it('fails when the provider declares no grants for the service', async () => {
    await expect(
      assertServiceEnforcesGrants({
        provider: fakeExtension({ name: 'plain', provides: [NOTES.name] }),
        service: NOTES,
        calls: {},
      }),
    ).rejects.toThrow(/declares no services.grants for notes/);
  });

  it('fails with the activation problem when the provider cannot be read', async () => {
    const broken = fakeExtension({
      name: 'notes-maker',
      provides: [NOTES.name],
      serviceGrants: { [NOTES.name]: [READ] },
      activate: () => {
        throw new TypeError('provider broke');
      },
    });

    await expect(
      assertServiceEnforcesGrants({
        provider: broken,
        service: NOTES,
        calls: { [READ]: (scope) => scope.read() },
      }),
    ).rejects.toThrow(/could not read notes/);
  });
});
