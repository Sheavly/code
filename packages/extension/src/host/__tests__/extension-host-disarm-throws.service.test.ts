import { describe, expect, it } from 'vitest';
import type { Extension } from '../../extension/extension.types.js';
import { defineService } from '../../extension/extension.utils.js';
import { fakeExtension } from '../../testing/extension.fake.js';
import { ExtensionHost } from '../extension-host.service.js';

const signal = new AbortController().signal;
const SVC = defineService<{ owner: string }>('svc');

/** A provider whose scope for `throwFor` throws from `disarm`; `armed` tracks each consumer's scope. */
function provider(params: { throwFor: string; armed: Record<string, boolean>; log: string[] }) {
  const { throwFor, armed, log } = params;

  return fakeExtension({
    name: 'prov',
    provides: [SVC.name],
    serviceGrants: { [SVC.name]: ['svc:use'] },
    activate: ({ services }) => {
      services.provideFor({
        key: SVC,
        create: (consumer) => {
          armed[consumer.name] = true;

          return {
            value: { owner: consumer.name },
            disarm: () => {
              armed[consumer.name] = false;
              log.push(`disarm ${consumer.name}`);

              if (consumer.name === throwFor) throw new Error(`disarm ${consumer.name} failed`);
            },
          };
        },
      });

      return {};
    },
    deactivate: () => void log.push('prov.deactivate'),
  });
}

function consumer(params: { name: string; log: string[]; failAfterRead?: boolean }): Extension {
  const { name, log, failAfterRead = false } = params;

  return fakeExtension({
    name,
    dependsOn: ['prov'],
    requires: [SVC.name],
    grants: ['svc:use'],
    activate: ({ services }) => {
      services.get(SVC);

      if (failAfterRead) throw new Error(`${name} activate failed`);

      return {};
    },
    deactivate: () => void log.push(`${name}.deactivate`),
  });
}

describe('a throwing service disarm is contained and reported', () => {
  it('does not abort the host stop: every deactivate runs, the other scopes are disarmed, the error is returned', async () => {
    const armed: Record<string, boolean> = {};
    const log: string[] = [];
    const host = new ExtensionHost({
      extensions: [
        provider({ throwFor: 'c1', armed, log }),
        consumer({ name: 'c1', log }),
        consumer({ name: 'c2', log }),
        consumer({ name: 'c3', log }),
        fakeExtension({ name: 'z', deactivate: () => void log.push('z.deactivate') }),
      ],
    });

    await host.activate({ signal });

    const errors = await host.deactivate();

    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('disarm c1 failed');
    expect(armed).toEqual({ c1: false, c2: false, c3: false });
    expect(log.filter((entry) => entry.endsWith('.deactivate')).toSorted()).toEqual([
      'c1.deactivate',
      'c2.deactivate',
      'c3.deactivate',
      'prov.deactivate',
      'z.deactivate',
    ]);
  });

  it('counts the instance as ended once, and a second deactivate does nothing', async () => {
    const log: string[] = [];
    const host = new ExtensionHost({
      extensions: [provider({ throwFor: 'c1', armed: {}, log }), consumer({ name: 'c1', log })],
    });

    await host.activate({ signal });
    await host.deactivate();

    expect(log.filter((entry) => entry === 'disarm c1')).toHaveLength(1);
    expect(await host.deactivate()).toEqual([]);
  });

  it('during a failing activation fails only that extension, resolves activate() and reports the error with the late ones', async () => {
    const armed: Record<string, boolean> = {};
    const log: string[] = [];
    const host = new ExtensionHost({
      extensions: [
        provider({ throwFor: 'bad', armed, log }),
        consumer({ name: 'bad', log, failAfterRead: true }),
        consumer({ name: 'ok', log }),
      ],
    });

    const result = await host.activate({ signal });

    expect(result.failed.map((failure) => failure.extension)).toEqual(['bad']);
    expect(result.active).toEqual(['prov', 'ok']);
    expect(result.lateDeactivationErrors.map((error) => (error as Error).message)).toEqual([
      'disarm bad failed',
    ]);
    expect(armed.bad).toBe(false);
    expect(armed.ok).toBe(true);
    // Reported once: the stop does not return it again.
    expect(await host.deactivate()).toEqual([]);
    expect(armed.ok).toBe(false);
  });
});
