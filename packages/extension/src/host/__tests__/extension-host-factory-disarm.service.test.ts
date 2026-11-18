import { describe, expect, it, vi } from 'vitest';
import type { Contributions, Extension, Services } from '../../extension/extension.types.js';
import { fakeExtension } from '../../testing/extension.fake.js';
import {
  FAKE_SCOPE,
  fakeScopeFactory,
  fakeScopeReader,
} from '../../testing/service-factory.fake.js';
import { ExtensionHost } from '../extension-host.service.js';

const signal = new AbortController().signal;

/** A host over `extensions` and the fake scope service, not yet activated. */
function rig(extensions: Extension[]) {
  const factory = fakeScopeFactory();
  const host = new ExtensionHost({ extensions, services: [factory.service] });

  return { ...factory, host };
}

describe('ExtensionHost disarms per-extension services wherever it disarms the emitter', () => {
  it('on deactivate(), before the extension deactivates', async () => {
    const during: string[][] = [];
    const { host, disarmed } = rig([
      fakeScopeReader({ deactivate: () => void during.push([...disarmed]) }),
    ]);

    await host.activate({ signal });
    expect(disarmed).toEqual([]);
    await host.deactivate();

    expect(disarmed).toEqual(['one']);
    expect(during).toEqual([['one']]);
  });

  it.each([
    [
      'activate throws after reading the service',
      (): Contributions => {
        throw new Error('boom');
      },
    ],
    [
      'the contribution fails the manifest check',
      (): Contributions => ({
        workKinds: [{ name: 'one.secret', description: 'x', completion: 'finite' }],
      }),
    ],
  ])('when %s', async (_what, outcome) => {
    const { host, disarmed } = rig([
      fakeScopeReader({
        activate: ({ services }) => {
          services.get(FAKE_SCOPE);

          return outcome();
        },
      }),
    ]);
    const result = await host.activate({ signal });

    expect(result.failed).toHaveLength(1);
    expect(disarmed).toEqual(['one']);
  });

  it('for an extension skipped for a missing service after the check built its instance', async () => {
    const { host, disarmed, built } = rig([
      fakeScopeReader({ requires: [FAKE_SCOPE.name, 'absent'] }),
    ]);
    const result = await host.activate({ signal });

    expect(result.skipped).toEqual([{ extension: 'one', reason: 'service', missing: ['absent'] }]);
    expect(built).toHaveLength(1);
    expect(disarmed).toEqual(['one']);
  });

  it('for an extension rolled back because its contribution changed, and its dependents', async () => {
    const list = [{ name: 'one.work', description: 'x', completion: 'finite' as const }];
    const { host, disarmed } = rig([
      fakeScopeReader({
        workKinds: ['one.work'],
        activate: ({ services }) => (services.get(FAKE_SCOPE), { workKinds: list }),
      }),
      fakeScopeReader({ name: 'dep', dependsOn: ['one'] }),
      fakeExtension({
        name: 'late',
        activate: () => {
          list.length = 0;

          return {};
        },
      }),
    ]);
    const result = await host.activate({ signal });

    expect(result.failed.map((failure) => failure.extension)).toEqual(['one']);
    expect(result.skipped).toEqual([{ extension: 'dep', reason: 'dependency' }]);
    expect(disarmed.toSorted()).toEqual(['dep', 'one']);
  });

  it('for an extension that finished activating after deactivate()', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { host, disarmed, built } = rig([
      fakeScopeReader({
        activate: async ({ services }) => {
          services.get(FAKE_SCOPE);
          await gate;

          return {};
        },
      }),
    ]);
    const activating = host.activate({ signal });

    await vi.waitFor(() => expect(built).toHaveLength(1));
    await host.deactivate();
    release();
    await activating;

    expect(disarmed).toEqual(['one']);
  });

  it('born disarmed: a service first read after the extension was stopped is already off', async () => {
    let late: Services | undefined;
    const { host, disarmed } = rig([
      fakeScopeReader({
        activate: ({ services }) => {
          late = services;

          return {};
        },
      }),
    ]);

    await host.activate({ signal });
    await host.deactivate();
    late?.get(FAKE_SCOPE);

    expect(disarmed).toEqual(['one']);
  });

  it('only once per instance, however many stop paths run', async () => {
    const { host, disarmed } = rig([fakeScopeReader()]);

    await host.activate({ signal });
    await host.deactivate();
    await host.deactivate();

    expect(disarmed).toEqual(['one']);
  });
});
