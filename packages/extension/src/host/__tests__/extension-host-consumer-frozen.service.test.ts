import { describe, expect, it } from 'vitest';
import { ExtensionUndeclaredError } from '../../errors/manifest.errors.js';
import type { ServiceConsumer } from '../../extension/extension.types.js';
import { defineService } from '../../extension/extension.utils.js';
import { fakeExtension, fakeTool } from '../../testing/extension.fake.js';
import {
  fakeGrantedConsumer,
  fakeGrantedProvider,
  GRANTED,
} from '../../testing/granted-service.fake.js';
import {
  FAKE_SCOPE,
  fakeScopeFactory,
  fakeScopeReader,
} from '../../testing/service-factory.fake.js';
import { ExtensionHost } from '../extension-host.service.js';

const signal = new AbortController().signal;
const OWN = defineService<{ owner: string }>('own');

/** An extension that provides `OWN` per consumer and reads it back, so it holds its own consumer object. */
function selfReader(params: {
  name: string;
  dependsOn?: string[];
  requires?: string[];
  held: ServiceConsumer[];
  after?: (read: <T>(key: { name: string; phantom?: T }) => T) => void;
}) {
  const { name, dependsOn = [], requires = [], held, after } = params;

  return fakeExtension({
    name,
    dependsOn,
    requires,
    optional: [OWN.name],
    provides: [OWN.name],
    activate: ({ services }) => {
      services.provideFor({
        key: OWN,
        create: (consumer) => (held.push(consumer), { value: { owner: consumer.name } }),
      });
      services.find(OWN);
      after?.((key) => services.get(key));

      return {};
    },
  });
}

describe('the consumer a factory receives is a frozen snapshot', () => {
  it('for a host service factory', async () => {
    const { service, built } = fakeScopeFactory();
    const host = new ExtensionHost({ extensions: [fakeScopeReader()], services: [service] });

    await host.activate({ signal });

    expect(FAKE_SCOPE.name).toBe('scope');
    expect(built).toHaveLength(1);
    expect(Object.isFrozen(built[0])).toBe(true);
  });

  it('for an extension provideFor create, and it is the same object the provider itself reads back', async () => {
    const { extension, built } = fakeGrantedProvider();
    const held: ServiceConsumer[] = [];
    const host = new ExtensionHost({
      extensions: [extension, fakeGrantedConsumer(), selfReader({ name: 'self', held })],
    });

    await host.activate({ signal });

    expect(built.map((consumer) => Object.isFrozen(consumer))).toEqual([true]);
    expect(held).toHaveLength(1);
    expect(Object.isFrozen(held[0])).toBe(true);
  });

  it('refuses a rename and a redefinition of contributedTools with a TypeError, and keeps both', async () => {
    const held: ServiceConsumer[] = [];
    const host = new ExtensionHost({ extensions: [selfReader({ name: 'self', held })] });

    await host.activate({ signal });

    const consumer = held[0] as { name: string; contributedTools: () => readonly string[] };
    const original = consumer.contributedTools;

    expect(() => {
      consumer.name = 'other';
    }).toThrow(TypeError);
    expect(() => {
      consumer.contributedTools = () => ['victim.tool'];
    }).toThrow(TypeError);
    expect(() =>
      Object.defineProperty(consumer, 'contributedTools', { value: () => ['victim.tool'] }),
    ).toThrow(TypeError);
    expect(() => Object.defineProperty(consumer, 'name', { value: 'other' })).toThrow(TypeError);
    expect(consumer.name).toBe('self');
    expect(consumer.contributedTools).toBe(original);
  });

  it('keeps answering live: empty before the merge, the names after, empty again once stopped', async () => {
    const { service, built } = fakeScopeFactory();
    const answers: string[] = [];
    const record = () => answers.push(built[0]!.contributedTools().join(',') || 'none');
    const reader = fakeScopeReader({
      tools: ['one.run'],
      activate: ({ services }) => {
        services.get(FAKE_SCOPE);
        record();

        return { tools: [fakeTool('one.run')] };
      },
    });
    const host = new ExtensionHost({ extensions: [reader], services: [service] });

    await host.activate({ signal });
    record();
    await host.deactivate();
    record();

    expect(answers).toEqual(['none', 'one.run', 'none']);
  });

  it('cannot be used to read another extension scope: an attacker that renames its own consumer still gets its own', async () => {
    const { extension } = fakeGrantedProvider();
    const held: ServiceConsumer[] = [];
    let renamed: unknown;
    let outcome: unknown;
    const attacker = selfReader({
      name: 'zz-attacker',
      dependsOn: ['maker', 'one'],
      requires: [GRANTED.name],
      held,
      after: (read) => {
        try {
          (held[0] as { name: string }).name = 'one';
        } catch (caughtError) {
          renamed = caughtError;
        }

        try {
          outcome = read(GRANTED)?.use();
        } catch (caughtError) {
          outcome = caughtError;
        }
      },
    });
    const host = new ExtensionHost({
      extensions: [extension, fakeGrantedConsumer(), attacker],
    });

    const result = await host.activate({ signal });

    expect(result.failed).toEqual([]);
    expect(renamed).toBeInstanceOf(TypeError);
    // `one` holds the grant, the attacker does not: reading as `one` would have returned 'one'.
    expect(outcome).toBeInstanceOf(ExtensionUndeclaredError);
    expect((outcome as ExtensionUndeclaredError).extension).toBe('zz-attacker');
  });
});
