import { describe, expect, it } from 'vitest';
import { ContributionCollisionError, MissingServiceError } from '../../errors/extension.errors.js';
import type { Extension } from '../../extension/extension.types.js';
import { defineService, hostService, hostServiceFor } from '../../extension/extension.utils.js';
import { fakeExtension } from '../../testing/extension.fake.js';
import {
  FAKE_SCOPE,
  fakeScopeFactory,
  fakeScopeReader,
} from '../../testing/service-factory.fake.js';
import { ExtensionHost } from '../extension-host.service.js';

const signal = new AbortController().signal;
const PLAIN = defineService<number>('plain');

/** A host over `extensions` and the fake scope service, already activated. */
async function activated(extensions: Extension[]) {
  const factory = fakeScopeFactory();
  const host = new ExtensionHost({ extensions, services: [factory.service] });
  const result = await host.activate({ signal });

  return { ...factory, host, result };
}

/** An extension named `name` that keeps what it reads from the scope, twice. */
function keeping(name: string, into: Map<string, unknown[]>) {
  return fakeScopeReader({
    name,
    activate: ({ services }) => {
      into.set(name, [services.get(FAKE_SCOPE), services.get(FAKE_SCOPE)]);

      return {};
    },
  });
}

describe('ExtensionHost with a service factory', () => {
  it('builds one instance per extension, the same one on every read', async () => {
    const seen = new Map<string, unknown[]>();
    const { built } = await activated([keeping('one', seen), keeping('two', seen)]);
    const [oneA, oneB] = seen.get('one') ?? [];
    const [twoA] = seen.get('two') ?? [];

    expect(oneA).toBe(oneB);
    expect(oneA).not.toBe(twoA);
    expect(oneA).toMatchObject({ owner: 'one' });
    expect(twoA).toMatchObject({ owner: 'two' });
    expect(built.map((extension) => extension.name)).toEqual(['one', 'two']);
  });

  it('gives the factory the extension name and the sealed, frozen manifest the host holds', async () => {
    const given = fakeScopeReader();
    const { built } = await activated([given]);

    expect(built[0]?.name).toBe('one');
    expect(built[0]?.manifest).toEqual(given.manifest);
    expect(Object.isFrozen(built[0]?.manifest)).toBe(true);
    expect(Object.isFrozen(built[0]?.manifest.services)).toBe(true);
  });

  it('builds lazily: nothing for an extension that never reads an optional service', async () => {
    const factory = fakeScopeFactory();
    const host = new ExtensionHost({
      extensions: [fakeExtension({ name: 'quiet', optional: [FAKE_SCOPE.name] })],
      services: [factory.service],
    });

    expect(factory.built).toEqual([]);
    await host.activate({ signal });
    expect(factory.built).toEqual([]);
  });

  it('still holds a read to the manifest: an undeclared name throws before any build', async () => {
    const { built, result } = await activated([fakeScopeReader({ requires: [] })]);

    expect(result.failed[0]?.cause).toMatchObject({
      name: 'ExtensionUndeclaredError',
      use: 'service get',
      undeclared: 'scope',
    });
    expect(built).toEqual([]);
  });

  it('serves find from the same per-extension instance', async () => {
    const found: unknown[] = [];

    await activated([
      fakeScopeReader({
        requires: [],
        optional: [FAKE_SCOPE.name],
        activate: ({ services }) => {
          found.push(services.find(FAKE_SCOPE), services.get(FAKE_SCOPE));

          return {};
        },
      }),
    ]);

    expect(found[0]).toBe(found[1]);
    expect(found[0]).toMatchObject({ owner: 'one' });
  });

  it('reads a factory that has nothing to give as not provided, with its grants still known', async () => {
    const OPTIONAL = defineService<object>('optional-thing');
    const found: unknown[] = [];
    let builds = 0;
    const host = new ExtensionHost({
      extensions: [
        fakeExtension({
          name: 'asks',
          optional: [OPTIONAL.name],
          grants: ['thing:read'],
          activate: ({ services }) => {
            found.push(services.find(OPTIONAL), services.find(OPTIONAL));

            return {};
          },
        }),
      ],
      services: [
        hostServiceFor({
          key: OPTIONAL,
          grants: ['thing:read'],
          create: () => {
            builds += 1;

            return undefined;
          },
        }),
      ],
    });
    const result = await host.activate({ signal });

    expect(result.failed).toEqual([]);
    expect(found).toEqual([undefined, undefined]);
    expect(builds).toBe(1);
  });

  it('skips an extension that requires a factory service with nothing to give, as missing', async () => {
    const NOTHING = defineService<object>('nothing');
    let activated = false;
    const host = new ExtensionHost({
      extensions: [
        fakeExtension({
          name: 'needs',
          requires: [NOTHING.name],
          activate: () => {
            activated = true;

            return {};
          },
        }),
      ],
      services: [hostServiceFor({ key: NOTHING, grants: [], create: () => undefined })],
    });
    const result = await host.activate({ signal });

    expect(activated).toBe(false);
    expect(result.skipped).toEqual([
      { extension: 'needs', reason: 'service', missing: [NOTHING.name] },
    ]);
  });

  it('builds the instance once for the skip check and the read: the same one comes back', async () => {
    const seen = new Map<string, unknown[]>();
    const { built } = await activated([keeping('one', seen)]);

    expect(built.map((extension) => extension.name)).toEqual(['one']);
  });

  it('refuses host.service for a factory service, and still reads a plain one', () => {
    const host = new ExtensionHost({
      extensions: [],
      services: [fakeScopeFactory().service, hostService({ key: PLAIN, value: 5 })],
    });

    expect(() => host.service(FAKE_SCOPE)).toThrow(MissingServiceError);
    expect(() => host.service(FAKE_SCOPE)).toThrow(/built per extension/);
    expect(host.service(PLAIN)).toBe(5);
  });

  it('refuses two services with one name, plain or factory', () => {
    const { service } = fakeScopeFactory();
    const plain = hostService({ key: FAKE_SCOPE, value: { owner: 'host', token: 0 } });
    const collide = (services: (typeof service)[]) => () =>
      new ExtensionHost({ extensions: [], services });

    expect(collide([service, plain])).toThrow(ContributionCollisionError);
    expect(collide([plain, service])).toThrow(ContributionCollisionError);
    expect(collide([service, fakeScopeFactory().service])).toThrow(/both the host and the host/);
  });

  it('does not let an extension provide a key a factory supplies', async () => {
    const { result } = await activated([
      fakeExtension({
        name: 'thief',
        provides: [FAKE_SCOPE.name],
        activate: ({ services }) => {
          services.provide(FAKE_SCOPE, { owner: 'thief', token: 0 });

          return {};
        },
      }),
    ]);

    expect(result.failed[0]?.cause).toBeInstanceOf(ContributionCollisionError);
  });
});
