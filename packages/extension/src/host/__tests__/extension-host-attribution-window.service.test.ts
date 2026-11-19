import { describe, expect, it } from 'vitest';
import { fakeExtension, fakeTool } from '../../testing/extension.fake.js';
import {
  FAKE_SCOPE,
  fakeScopeFactory,
  fakeScopeReader,
} from '../../testing/service-factory.fake.js';
import { ExtensionHost } from '../extension-host.service.js';

const signal = new AbortController().signal;

/** The accessor of the extension the fake scope was built for at `index`. */
function accessorAt(built: ReturnType<typeof fakeScopeFactory>['built'], index: number) {
  const consumer = built[index];

  if (!consumer) throw new Error(`the fake scope was never built for extension ${index}`);

  return consumer.contributedTools;
}

/** `one` contributes `one.a`; `two` activates after it and records what `one`'s accessor holds. */
function hostWhereTwoWatchesOne(params: {
  factory: ReturnType<typeof fakeScopeFactory>;
  seen: (readonly string[])[];
  twoActivate?: () => void;
}) {
  const { factory, seen, twoActivate } = params;

  return new ExtensionHost({
    extensions: [
      fakeScopeReader({
        tools: ['one.a'],
        activate: ({ services }) => (services.get(FAKE_SCOPE), { tools: [fakeTool('one.a')] }),
      }),
      fakeExtension({
        name: 'two',
        requires: [FAKE_SCOPE.name],
        activate: ({ services }) => {
          services.get(FAKE_SCOPE);
          seen.push(accessorAt(factory.built, 0)());
          twoActivate?.();

          return {};
        },
      }),
    ],
    services: [factory.service],
  });
}

describe('ServiceConsumer.contributedTools before the merge', () => {
  it('is empty for an extension already verified while a later one activates', async () => {
    const factory = fakeScopeFactory();
    const seen: (readonly string[])[] = [];

    await hostWhereTwoWatchesOne({ factory, seen }).activate({ signal });

    expect(seen).toEqual([[]]);
  });

  it('holds the checked names of every extension once activate passed the merge', async () => {
    const factory = fakeScopeFactory();
    const host = hostWhereTwoWatchesOne({ factory, seen: [] });

    const result = await host.activate({ signal });

    expect(result.active).toEqual(['one', 'two']);
    expect(accessorAt(factory.built, 0)()).toEqual(['one.a']);
  });

  it('is empty again after deactivate, for a merged extension', async () => {
    const factory = fakeScopeFactory();
    const host = hostWhereTwoWatchesOne({ factory, seen: [] });

    await host.activate({ signal });
    await host.deactivate();

    expect(accessorAt(factory.built, 0)()).toEqual([]);
  });

  it('is empty when deactivate closes the host while a later extension activates', async () => {
    const factory = fakeScopeFactory();
    const seen: (readonly string[])[] = [];
    const host: ExtensionHost = hostWhereTwoWatchesOne({
      factory,
      seen,
      twoActivate: () => void host.deactivate(),
    });

    await host.activate({ signal });

    expect(accessorAt(factory.built, 0)()).toEqual([]);
  });

  it('is empty for an extension skipped because a service it requires is missing', async () => {
    const factory = fakeScopeFactory();
    const host = new ExtensionHost({
      extensions: [fakeScopeReader({ requires: [FAKE_SCOPE.name, 'nobody-offers-this'] })],
      services: [factory.service],
    });

    const result = await host.activate({ signal });

    expect(result.skipped.map((skipped) => skipped.extension)).toEqual(['one']);
    expect(factory.built.map((consumer) => consumer.contributedTools())).toEqual([[]]);
  });

  it('is empty for an extension rolled back after its contributions changed, and for its dependent', async () => {
    const factory = fakeScopeFactory();
    const shared = [fakeTool('one.a')];
    const reader = (name: string, dependsOn: string[], tool: string) =>
      fakeExtension({
        name,
        dependsOn,
        requires: [FAKE_SCOPE.name],
        tools: [tool],
        activate: ({ services }) => (services.get(FAKE_SCOPE), { tools: [fakeTool(tool)] }),
      });
    const host = new ExtensionHost({
      extensions: [
        fakeExtension({
          name: 'one',
          requires: [FAKE_SCOPE.name],
          tools: ['one.a'],
          activate: ({ services }) => (services.get(FAKE_SCOPE), { tools: shared }),
        }),
        reader('two', ['one'], 'two.b'),
        fakeExtension({
          name: 'three',
          activate: () => {
            shared.splice(0);

            return {};
          },
        }),
      ],
      services: [factory.service],
    });

    const result = await host.activate({ signal });

    expect(result.active).toEqual(['three']);
    expect(factory.built.map((consumer) => consumer.contributedTools())).toEqual([[], []]);
  });
});
