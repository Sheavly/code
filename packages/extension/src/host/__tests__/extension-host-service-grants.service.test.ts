import { describe, expect, it } from 'vitest';
import {
  ContributionCollisionError,
  ExtensionDefinitionError,
  MissingServiceError,
} from '../../errors/extension.errors.js';
import { ExtensionGrantError, ExtensionUndeclaredError } from '../../errors/manifest.errors.js';
import type { Extension } from '../../extension/extension.types.js';
import { defineService, hostService } from '../../extension/extension.utils.js';
import { fakeExtension, fakeTool } from '../../testing/extension.fake.js';
import { GRANTED_GRANT } from '../../testing/granted-service.constants.js';
import {
  fakeGrantedConsumer,
  fakeGrantedProvider,
  GRANTED,
} from '../../testing/granted-service.fake.js';
import type { FakeExtensionFields, GrantedScope } from '../../testing/extension-fake.types.js';
import { ExtensionHost } from '../extension-host.service.js';

const signal = new AbortController().signal;

/** A consumer that keeps what it reads from the granted service, twice, in `into`. */
function keeping(name: string, into: Map<string, GrantedScope[]>, grants = [GRANTED_GRANT]) {
  return fakeGrantedConsumer({
    name,
    grants,
    activate: ({ services }) => {
      into.set(name, [services.get(GRANTED), services.get(GRANTED)]);

      return {};
    },
  });
}

/** An extension that gives `GRANTED` with `provide`: one shared value, which checks nobody. */
function plainProvider(fields: Partial<FakeExtensionFields>) {
  return fakeExtension({
    name: 'maker',
    provides: [GRANTED.name],
    activate: ({ services }) => {
      services.provide(GRANTED, { owner: 'x', token: 0, use: () => 'x' });

      return {};
    },
    ...fields,
  });
}

async function activate(extensions: Extension[]) {
  const host = new ExtensionHost({ extensions });
  const result = await host.activate({ signal });

  return { host, result };
}

describe('an extension-provided service enforces grants through the consumer it is built for', () => {
  it('lets a consumer that holds the grant use its scope', async () => {
    const seen = new Map<string, GrantedScope[]>();
    const { extension } = fakeGrantedProvider();
    const { result } = await activate([extension, keeping('one', seen)]);

    expect(result.failed).toEqual([]);
    expect(seen.get('one')?.[0]?.use()).toBe('one');
  });

  it('refuses a consumer without the grant with the undeclared-grant error from the provider', async () => {
    const seen = new Map<string, GrantedScope[]>();
    const { extension } = fakeGrantedProvider();

    await activate([extension, keeping('bare', seen, [])]);

    const refusal = (() => {
      try {
        seen.get('bare')?.[0]?.use();
      } catch (caughtError) {
        return caughtError;
      }

      return undefined;
    })();

    expect(refusal).toBeInstanceOf(ExtensionUndeclaredError);
    expect(refusal).toMatchObject({ extension: 'bare', use: 'grant', undeclared: GRANTED_GRANT });
  });

  it('builds a different value per consumer and the same one on every read of one consumer', async () => {
    const seen = new Map<string, GrantedScope[]>();
    const { extension, built } = fakeGrantedProvider();

    await activate([extension, keeping('one', seen), keeping('two', seen)]);

    const reads = { one: seen.get('one') ?? [], two: seen.get('two') ?? [] };

    expect(reads.one).toHaveLength(2);
    expect(reads.one[1]).toBe(reads.one[0]);
    expect(reads.two[0]).not.toBe(reads.one[0]);
    expect(reads.two[0]).toMatchObject({ owner: 'two' });
    expect(built.map((consumer) => consumer.name)).toEqual(['one', 'two']);
  });

  it('builds lazily, only for a consumer that reads it, with its sealed manifest', async () => {
    const { extension, built } = fakeGrantedProvider();
    const idle = fakeExtension({ name: 'idle', dependsOn: ['maker'] });
    const reader = fakeGrantedConsumer();

    await activate([extension, idle, reader]);

    expect(built.map((consumer) => consumer.name)).toEqual(['one']);
    expect(built[0]?.manifest).toEqual(reader.manifest);
    expect(Object.isFrozen(built[0]?.manifest)).toBe(true);
  });

  it('gives the provider the consumer live contributed tools: none while it activates, its names once merged', async () => {
    const { extension, built } = fakeGrantedProvider();
    const during: (readonly string[])[] = [];
    const consumer = fakeGrantedConsumer({
      tools: ['one.run'],
      activate: ({ services }) => {
        services.get(GRANTED);
        during.push(built[0]?.contributedTools() ?? ['unbuilt']);

        return { tools: [fakeTool('one.run')] };
      },
    });

    await activate([extension, consumer]);

    expect(during).toEqual([[]]);
    expect(built[0]?.contributedTools()).toEqual(['one.run']);
  });

  it('keeps the provider reading its own key as a consumer like any other', async () => {
    let own: GrantedScope | undefined;
    const built: string[] = [];
    const maker = fakeExtension({
      name: 'maker',
      provides: [GRANTED.name],
      serviceGrants: { [GRANTED.name]: [GRANTED_GRANT] },
      optional: [GRANTED.name],
      grants: [GRANTED_GRANT],
      activate: ({ services }) => {
        services.provideFor({
          key: GRANTED,
          create: (consumer) => {
            built.push(consumer.name);

            return { value: { owner: consumer.name, token: 0, use: () => consumer.name } };
          },
        });
        own = services.find(GRANTED);

        return {};
      },
    });

    await activate([maker]);

    expect(built).toEqual(['maker']);
    expect(own?.use()).toBe('maker');
  });

  it('does not call create for an extension that does not depend on the provider', async () => {
    const { extension, built } = fakeGrantedProvider();
    const stranger = fakeGrantedConsumer({
      name: 'stranger',
      dependsOn: [],
      requires: [],
      optional: [GRANTED.name],
      activate: ({ services }) => (services.find(GRANTED), {}),
    });
    const { result } = await activate([extension, stranger]);

    expect(result.failed[0]?.cause).toBeInstanceOf(MissingServiceError);
    expect(built).toEqual([]);
  });

  it('refuses the read of an extension whose manifest does not declare the service', async () => {
    const { extension, built } = fakeGrantedProvider();
    const { result } = await activate([
      extension,
      fakeGrantedConsumer({ requires: [], grants: [] }),
    ]);

    expect(result.failed[0]?.cause).toBeInstanceOf(ExtensionUndeclaredError);
    expect(built).toEqual([]);
  });
});

describe('the catalogue verifies grants an extension offers', () => {
  it('fails a consumer that lists the grant without the service in requires or optional', async () => {
    const { extension } = fakeGrantedProvider();
    const { result } = await activate([
      extension,
      fakeGrantedConsumer({ requires: [], activate: () => ({}) }),
    ]);
    const cause = result.failed[0]?.cause as Error;

    expect(cause).toBeInstanceOf(ExtensionGrantError);
    expect(cause).toMatchObject({ extension: 'one', grant: GRANTED_GRANT });
    expect(cause.message).toContain('"granted"');
    expect(cause.message).toContain('does not list in services.requires or services.optional');
  });

  it('accepts the service in optional', async () => {
    const { extension } = fakeGrantedProvider();
    const { result } = await activate([
      extension,
      fakeGrantedConsumer({
        requires: [],
        optional: [GRANTED.name],
        activate: ({ services }) => (services.find(GRANTED), {}),
      }),
    ]);

    expect(result.failed).toEqual([]);
    expect(result.active).toEqual(['maker', 'one']);
  });

  it('fails a typo of the grant', async () => {
    const { extension } = fakeGrantedProvider();
    const { result } = await activate([
      extension,
      fakeGrantedConsumer({ grants: ['granted:usee'] }),
    ]);

    expect(result.failed[0]?.cause).toBeInstanceOf(ExtensionGrantError);
    expect(result.failed[0]?.cause).toMatchObject({ grant: 'granted:usee' });
  });

  it('accepts a grant two services offer', async () => {
    const other = fakeExtension({
      name: 'other',
      provides: ['second'],
      serviceGrants: { second: [GRANTED_GRANT] },
      activate: ({ services }) => {
        services.provideFor({ key: defineService<number>('second'), create: () => ({ value: 1 }) });

        return {};
      },
    });
    const { extension } = fakeGrantedProvider();
    const { result } = await activate([
      extension,
      other,
      fakeGrantedConsumer({ dependsOn: ['maker', 'other'] }),
    ]);

    expect(result.failed).toEqual([]);
  });

  it('keeps the grant when the provider is skipped, so the consumer reads the service as missing', async () => {
    const { extension } = fakeGrantedProvider({ origin: 'project' });
    const required = fakeGrantedConsumer({ dependsOn: [] });
    const optional = fakeGrantedConsumer({
      name: 'two',
      dependsOn: [],
      requires: [],
      optional: [GRANTED.name],
      activate: ({ services }) => {
        expect(services.find(GRANTED)).toBeUndefined();

        return {};
      },
    });
    const { result } = await activate([extension, required, optional]);

    expect(result.skipped).toEqual([
      { extension: 'maker', reason: 'untrusted' },
      { extension: 'one', reason: 'service', missing: [GRANTED.name] },
    ]);
    expect(result.failed).toEqual([]);
    expect(result.active).toEqual(['two']);
  });
});

describe('what a provider may provide', () => {
  it('fails a provider that gives a service with declared grants through provide', async () => {
    const maker = plainProvider({ serviceGrants: { [GRANTED.name]: [GRANTED_GRANT] } });
    const { result } = await activate([maker]);
    const cause = result.failed[0]?.cause as Error;

    expect(cause).toBeInstanceOf(ExtensionDefinitionError);
    expect(cause.message).toContain('Extension maker');
    expect(cause.message).toContain('"granted"');
    expect(cause.message).toContain('provideFor');
  });

  it('allows provideFor for a service that declares no grants', async () => {
    const maker = fakeExtension({
      name: 'maker',
      provides: ['plain'],
      activate: ({ services }) => {
        services.provideFor({ key: defineService<number>('plain'), create: () => ({ value: 7 }) });

        return {};
      },
    });
    const reader = fakeExtension({
      name: 'one',
      dependsOn: ['maker'],
      requires: ['plain'],
      activate: ({ services }) => {
        expect(services.get(defineService<number>('plain'))).toBe(7);

        return {};
      },
    });
    const { result } = await activate([maker, reader]);

    expect(result.failed).toEqual([]);
  });

  it('refuses provideFor of a key the provider does not list in provides', async () => {
    const maker = fakeExtension({
      name: 'maker',
      activate: ({ services }) => {
        services.provideFor({
          key: GRANTED,
          create: () => ({ value: { owner: 'x', token: 0, use: () => 'x' } }),
        });

        return {};
      },
    });
    const { result } = await activate([maker]);

    expect(result.failed[0]?.cause).toBeInstanceOf(ExtensionUndeclaredError);
    expect(result.failed[0]?.cause).toMatchObject({
      use: 'service provide',
      undeclared: 'granted',
    });
  });

  it('collides provide and provideFor of one key by two extensions, naming both', async () => {
    const { extension } = fakeGrantedProvider();
    const { result } = await activate([extension, plainProvider({ name: 'plain' })]);
    const cause = result.failed[0]?.cause as Error;

    expect(cause).toBeInstanceOf(ContributionCollisionError);
    expect(cause.message).toContain('both maker and plain');
  });

  it('collides provideFor with a service the host supplies, naming the host', async () => {
    const { extension } = fakeGrantedProvider();
    const host = new ExtensionHost({
      extensions: [extension],
      services: [hostService({ key: GRANTED, value: { owner: 'h', token: 0, use: () => 'h' } })],
    });
    const result = await host.activate({ signal });
    const cause = result.failed[0]?.cause as Error;

    expect(cause).toBeInstanceOf(ContributionCollisionError);
    expect(cause.message).toContain('both the host and maker');
  });

  it('rejects a service built per consumer for the app, which holds no manifest', async () => {
    const { extension } = fakeGrantedProvider();
    const { host } = await activate([extension]);

    expect(() => host.service(GRANTED)).toThrow(MissingServiceError);
  });
});
