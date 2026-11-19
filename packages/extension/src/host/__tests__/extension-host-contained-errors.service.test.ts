import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContributionCollisionError } from '../../errors/extension.errors.js';
import type { Extension, ServiceConsumer, Services } from '../../extension/extension.types.js';
import { defineService, hostServiceFor } from '../../extension/extension.utils.js';
import { fakeExtension, fakeTool } from '../../testing/extension.fake.js';
import { FAKE_SCOPE, fakeScopeReader } from '../../testing/service-factory.fake.js';
import { ExtensionHost } from '../extension-host.service.js';
import type { ExtensionHostOptions } from '../extension-host.types.js';

const SVC = defineService<{ owner: string }>('svc');
const signal = new AbortController().signal;
const messages = (errors: readonly unknown[]) => errors.map((error) => (error as Error).message);

/** Lets a promise that rejected without a handler reach the process's `unhandledRejection`. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** A `disarm` as the type promises it (`void`), though it hands back what `run` returns. */
const disarmReturning = (run: () => unknown): (() => void) => run;

/** An extension providing `svc` per consumer, each scope disarmed through `disarm`. */
function serviceProvider(params: {
  disarm: (consumer: string) => unknown;
  deactivate?: () => void;
}) {
  const create = (who: ServiceConsumer) => ({
    value: { owner: who.name },
    disarm: disarmReturning(() => params.disarm(who.name)),
  });

  return fakeExtension({
    name: 'prov',
    provides: [SVC.name],
    serviceGrants: { [SVC.name]: ['svc:use'] },
    activate: ({ services }) => (services.provideFor({ key: SVC, create }), {}),
    ...(params.deactivate && { deactivate: params.deactivate }),
  });
}

/** A provider whose scope for a consumer in `failing` throws from `disarm`. */
function throwingProvider(params: { failing: readonly string[]; deactivateFails?: boolean }) {
  return serviceProvider({
    disarm: (name) => {
      if (params.failing.includes(name)) throw new Error(`disarm ${name}`);
    },
    deactivate: () => {
      if (params.deactivateFails) throw new Error('prov deactivate');
    },
  });
}

function consumer(params: {
  name: string;
  tool?: string;
  failAfterRead?: boolean;
  onActivate?: () => void;
}): Extension {
  const { name, tool, failAfterRead = false, onActivate } = params;

  return fakeExtension({
    name,
    dependsOn: ['prov'],
    requires: [SVC.name],
    grants: ['svc:use'],
    ...(tool && { tools: [tool] }),
    activate: ({ services }) => {
      services.get(SVC);
      onActivate?.();

      if (failAfterRead) throw new Error(`${name} activate failed`);

      return tool ? { tools: [fakeTool(tool)] } : {};
    },
  });
}

describe('a disarm that returns a rejected promise', () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => void unhandled.push(reason);

  beforeEach(() => {
    unhandled.length = 0;
    process.on('unhandledRejection', onUnhandled);
  });

  afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
  });

  /**
   * Stops `host` and shows the rejection was neither unhandled nor lost: the stop or the next
   * call returns it (which one depends on when it settles), once.
   */
  async function expectCollected(host: ExtensionHost, message: string) {
    await host.activate({ signal });

    const first = await host.deactivate();

    await settle();

    const second = await host.deactivate();

    expect(unhandled).toEqual([]);
    expect(messages([...first, ...second])).toEqual([message]);
    expect(await host.deactivate()).toEqual([]);
  }

  it('from a host service is collected, never unhandled', async () => {
    const service = hostServiceFor({
      key: FAKE_SCOPE,
      grants: ['scope:use'],
      create: (who) => ({
        value: { owner: who.name, token: 1 },
        disarm: disarmReturning(async () => {
          throw new Error('async host disarm');
        }),
      }),
    });

    await expectCollected(
      new ExtensionHost({ extensions: [fakeScopeReader()], services: [service] }),
      'async host disarm',
    );
  });

  it('from an extension service is collected, never unhandled', async () => {
    const host = new ExtensionHost({
      extensions: [
        serviceProvider({
          disarm: async () => {
            throw new Error('async ext disarm');
          },
        }),
        consumer({ name: 'c1' }),
      ],
    });

    await expectCollected(host, 'async ext disarm');
  });

  it('does not block the stop when it never settles', async () => {
    const host = new ExtensionHost({
      extensions: [
        serviceProvider({ disarm: () => new Promise<void>(() => undefined) }),
        consumer({ name: 'c1' }),
      ],
    });

    await host.activate({ signal });

    expect(await host.deactivate()).toEqual([]);
  });
});

describe('what a failed activation closed the host with', () => {
  it('is returned once by the next deactivate() when a collision fails the activation, whose error is unchanged', async () => {
    const host = new ExtensionHost({
      extensions: [
        throwingProvider({ failing: ['bad', 'c1', 'c2'], deactivateFails: true }),
        // Fails while activating: its disarm error is taken before the merge that throws.
        consumer({ name: 'bad', failAfterRead: true }),
        consumer({ name: 'c1', tool: 'shared' }),
        consumer({ name: 'c2', tool: 'shared' }),
      ],
    });
    const caught = await host.activate({ signal }).catch((caughtError: unknown) => caughtError);

    expect(caught).toBeInstanceOf(ContributionCollisionError);
    expect(Object.getPrototypeOf(caught)).toBe(ContributionCollisionError.prototype);
    expect(messages(await host.deactivate()).toSorted()).toEqual([
      'disarm bad',
      'disarm c1',
      'disarm c2',
      'prov deactivate',
    ]);
    expect(await host.deactivate()).toEqual([]);
  });

  it('is returned once by the next deactivate() when an abort stops the activation, with the abort reason thrown', async () => {
    const controller = new AbortController();
    const reason = new Error('stop now');
    const host = new ExtensionHost({
      extensions: [
        throwingProvider({ failing: ['c1'], deactivateFails: true }),
        consumer({ name: 'c1', onActivate: () => controller.abort(reason) }),
      ],
    });

    await expect(host.activate({ signal: controller.signal })).rejects.toBe(reason);
    expect(messages(await host.deactivate()).toSorted()).toEqual(['disarm c1', 'prov deactivate']);
    expect(await host.deactivate()).toEqual([]);
  });

  it('includes the error of a scope built after the close, born disarmed', async () => {
    let late: Services | undefined;
    const host = new ExtensionHost({
      extensions: [
        throwingProvider({ failing: ['late'] }),
        fakeExtension({
          name: 'late',
          dependsOn: ['prov'],
          // Optional: nothing builds its scope until it reads it, which it does after the close.
          optional: [SVC.name],
          grants: ['svc:use'],
          activate: ({ services }) => {
            late = services;

            return {};
          },
        }),
      ],
    });

    await host.activate({ signal });
    expect(await host.deactivate()).toEqual([]);
    late?.find(SVC);

    expect(messages(await host.deactivate())).toEqual(['disarm late']);
    expect(await host.deactivate()).toEqual([]);
  });
});

describe('the trust check', () => {
  it('is called as a method of the options, so an isTrusted that reads this works', async () => {
    const owners: unknown[] = [];
    const options: ExtensionHostOptions = {
      extensions: [fakeExtension({ name: 'from-repo', origin: 'project' })],
      isTrusted() {
        owners.push(this);

        return true;
      },
    };
    const result = await new ExtensionHost(options).activate({ signal });

    expect(result.active).toEqual(['from-repo']);
    expect(owners).toHaveLength(1);
    expect(owners[0]).toBe(options);
  });
});
