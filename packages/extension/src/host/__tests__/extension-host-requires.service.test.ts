import { describe, expect, it } from 'vitest';
import { defineService, hostService } from '../../extension/extension.utils.js';
import { fakeExtension } from '../../testing/extension.fake.js';
import { ExtensionHost } from '../extension-host.service.js';

const signal = new AbortController().signal;
const COUNTER = defineService<number>('counter');

/** An extension that requires the counter and records that it activated. */
function needsCounter(params: { name: string; log: string[]; dependsOn?: string[] }) {
  const { name, log, dependsOn = [] } = params;

  return fakeExtension({
    name,
    dependsOn,
    requires: [COUNTER.name],
    activate: ({ services }) => {
      log.push(`${name} read ${services.get(COUNTER)}`);

      return {};
    },
  });
}

/** An extension that provides the counter. */
function providesCounter(name: string) {
  return fakeExtension({
    name,
    provides: [COUNTER.name],
    activate: ({ services }) => {
      services.provide(COUNTER, 7);

      return {};
    },
  });
}

describe('ExtensionHost required services', () => {
  it('activates an extension whose required service the host supplies', async () => {
    const log: string[] = [];
    const host = new ExtensionHost({
      services: [hostService({ key: COUNTER, value: 42 })],
      extensions: [needsCounter({ name: 'reader', log })],
    });
    const result = await host.activate({ signal });

    expect(result.active).toEqual(['reader']);
    expect(result.skipped).toEqual([]);
    expect(log).toEqual(['reader read 42']);
  });

  it('activates an extension whose required service a dependency provides', async () => {
    const log: string[] = [];
    const host = new ExtensionHost({
      extensions: [
        needsCounter({ name: 'reader', log, dependsOn: ['provider'] }),
        providesCounter('provider'),
      ],
    });
    const result = await host.activate({ signal });

    expect(result.active).toEqual(['provider', 'reader']);
    expect(log).toEqual(['reader read 7']);
  });

  it('skips an extension whose required service nobody offers, without activating it', async () => {
    const log: string[] = [];
    const host = new ExtensionHost({ extensions: [needsCounter({ name: 'reader', log })] });
    const result = await host.activate({ signal });

    expect(result.active).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.skipped).toEqual([
      { extension: 'reader', reason: 'service', missing: [COUNTER.name] },
    ]);
    expect(log).toEqual([]);
  });

  it('names every missing service, and none that is offered', async () => {
    const host = new ExtensionHost({
      services: [hostService({ key: COUNTER, value: 1 })],
      extensions: [
        fakeExtension({ name: 'reader', requires: [COUNTER.name, 'sessions', 'tasks'] }),
      ],
    });
    const result = await host.activate({ signal });

    expect(result.skipped).toEqual([
      { extension: 'reader', reason: 'service', missing: ['sessions', 'tasks'] },
    ]);
  });

  it('skips an extension whose service comes from an extension it does not depend on', async () => {
    const log: string[] = [];
    const host = new ExtensionHost({
      extensions: [providesCounter('provider'), needsCounter({ name: 'reader', log })],
    });
    const result = await host.activate({ signal });

    expect(result.active).toEqual(['provider']);
    expect(result.skipped).toEqual([
      { extension: 'reader', reason: 'service', missing: [COUNTER.name] },
    ]);
  });

  it('skips the extensions that depend on a skipped one, and leaves the others alone', async () => {
    const log: string[] = [];
    const host = new ExtensionHost({
      extensions: [
        needsCounter({ name: 'reader', log }),
        fakeExtension({ name: 'child', dependsOn: ['reader'] }),
        fakeExtension({ name: 'fine' }),
      ],
    });
    const result = await host.activate({ signal });

    expect(result.active).toEqual(['fine']);
    expect(result.skipped).toEqual([
      { extension: 'reader', reason: 'service', missing: [COUNTER.name] },
      { extension: 'child', reason: 'dependency' },
    ]);
  });

  it('does not require an optional service', async () => {
    const host = new ExtensionHost({
      extensions: [fakeExtension({ name: 'reader', optional: [COUNTER.name] })],
    });

    expect((await host.activate({ signal })).active).toEqual(['reader']);
  });

  it('checks an untrusted extension’s trust before its services', async () => {
    const host = new ExtensionHost({
      extensions: [fakeExtension({ name: 'from-repo', origin: 'project', requires: ['x'] })],
    });

    expect((await host.activate({ signal })).skipped).toEqual([
      { extension: 'from-repo', reason: 'untrusted' },
    ]);
  });
});
