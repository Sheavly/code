import { describe, expect, it } from 'vitest';
import { defineService, hostService } from '../../extension/extension.utils.js';
import { fakeExtension, fakeTool } from '../../testing/extension.fake.js';
import {
  FAKE_SCOPE,
  fakeScopeFactory,
  fakeScopeReader,
} from '../../testing/service-factory.fake.js';
import { ExtensionHost } from '../extension-host.service.js';

const signal = new AbortController().signal;

/** The accessor the host gave the one extension the fake scope was built for. */
function accessorOf(built: ReturnType<typeof fakeScopeFactory>['built']) {
  const consumer = built[0];

  if (!consumer) throw new Error('the fake scope was never built');

  return consumer.contributedTools;
}

describe('ServiceConsumer.contributedTools', () => {
  it('is empty while activate runs and holds the checked names once it returned', async () => {
    const factory = fakeScopeFactory();
    const during: (readonly string[])[] = [];
    const host = new ExtensionHost({
      extensions: [
        fakeScopeReader({
          tools: ['one.a', 'one.b'],
          activate: ({ services }) => {
            services.get(FAKE_SCOPE);
            during.push(accessorOf(factory.built)());

            return { tools: [fakeTool('one.a'), fakeTool('one.b')] };
          },
        }),
      ],
      services: [factory.service],
    });

    await host.activate({ signal });

    expect(during).toEqual([[]]);
    expect(accessorOf(factory.built)()).toEqual(['one.a', 'one.b']);
  });

  it('does not hold a tool the manifest declares but the extension does not contribute', async () => {
    const factory = fakeScopeFactory();
    const host = new ExtensionHost({
      extensions: [
        fakeScopeReader({
          tools: ['one.declared', 'one.contributed'],
          activate: ({ services }) => (
            services.get(FAKE_SCOPE),
            { tools: [fakeTool('one.contributed')] }
          ),
        }),
      ],
      services: [factory.service],
    });

    await host.activate({ signal });

    expect(accessorOf(factory.built)()).toEqual(['one.contributed']);
  });

  it('is empty again once the extension is stopped', async () => {
    const factory = fakeScopeFactory();
    const host = new ExtensionHost({
      extensions: [
        fakeScopeReader({
          tools: ['one.a'],
          activate: ({ services }) => (services.get(FAKE_SCOPE), { tools: [fakeTool('one.a')] }),
        }),
      ],
      services: [factory.service],
    });

    await host.activate({ signal });
    await host.deactivate();

    expect(accessorOf(factory.built)()).toEqual([]);
  });

  it('stays empty for an extension whose activation failed', async () => {
    const factory = fakeScopeFactory();
    const host = new ExtensionHost({
      extensions: [
        fakeScopeReader({
          activate: ({ services }) => {
            services.get(FAKE_SCOPE);

            throw new Error('boom');
          },
        }),
      ],
      services: [factory.service],
    });

    const result = await host.activate({ signal });

    expect(result.failed).toHaveLength(1);
    expect(accessorOf(factory.built)()).toEqual([]);
  });

  it('is empty for an extension rolled back after its contributions changed', async () => {
    const factory = fakeScopeFactory();
    const tools = [fakeTool('one.a')];
    const host = new ExtensionHost({
      extensions: [
        fakeScopeReader({
          tools: ['one.a'],
          activate: ({ services }) => (services.get(FAKE_SCOPE), { tools }),
        }),
        fakeExtension({
          name: 'late',
          activate: () => {
            tools.length = 0;

            return {};
          },
        }),
      ],
      services: [factory.service],
    });

    const result = await host.activate({ signal });

    expect(result.failed.map((failure) => failure.extension)).toEqual(['one']);
    expect(accessorOf(factory.built)()).toEqual([]);
  });

  it('leaves plain services as they were', async () => {
    const GREETING = defineService<string>('greeting');
    const host = new ExtensionHost({
      extensions: [fakeExtension({ name: 'one', requires: [GREETING.name] })],
      services: [hostService({ key: GREETING, value: 'hi' })],
    });

    const result = await host.activate({ signal });

    expect(result.active).toEqual(['one']);
    expect(host.service(GREETING)).toBe('hi');
  });
});
