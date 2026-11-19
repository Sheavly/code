import { describe, expect, it } from 'vitest';
import type { Contributions, Extension } from '../../extension/extension.types.js';
import { fakeExtension } from '../../testing/extension.fake.js';
import {
  fakeGrantedConsumer,
  fakeGrantedProvider,
  GRANTED,
} from '../../testing/granted-service.fake.js';
import type { GrantedScope } from '../../testing/extension-fake.types.js';
import { ExtensionHost } from '../extension-host.service.js';

const signal = new AbortController().signal;

/** An `activate` that empties a list another extension returned, so that one's contribution changed. */
function emptying(list: unknown[]) {
  return (): Contributions => {
    list.splice(0);

    return {};
  };
}

/** A host over `extensions`, not yet activated. */
function hostOf(extensions: Extension[]) {
  return new ExtensionHost({ extensions });
}

describe('ExtensionHost disarms the scopes an extension provides per consumer', () => {
  it('on the consumer deactivate(), and the scope then refuses use', async () => {
    let kept: GrantedScope | undefined;
    const { extension, disarmed } = fakeGrantedProvider();
    const host = hostOf([
      extension,
      fakeGrantedConsumer({
        activate: ({ services }) => ((kept = services.get(GRANTED)), {}),
      }),
    ]);

    await host.activate({ signal });
    expect(disarmed).toEqual([]);
    await host.deactivate();

    expect(disarmed.toSorted()).toEqual(['one']);
    expect(() => kept?.use()).toThrow('deactivated');
  });

  it('for a consumer whose activation failed, and only its own scope', async () => {
    const { extension, disarmed } = fakeGrantedProvider();
    const host = hostOf([
      extension,
      fakeGrantedConsumer({
        name: 'bad',
        activate: ({ services }) => {
          services.get(GRANTED);
          throw new Error('boom');
        },
      }),
      fakeGrantedConsumer({ name: 'good' }),
    ]);
    const result = await host.activate({ signal });

    expect(result.failed.map((failure) => failure.extension)).toEqual(['bad']);
    expect(disarmed).toEqual(['bad']);
  });

  it('for a consumer rolled back because its contribution changed, with its provider still running', async () => {
    const list = [{ name: 'one.work', description: 'x', completion: 'finite' as const }];
    const { extension, disarmed } = fakeGrantedProvider();
    const host = hostOf([
      extension,
      fakeGrantedConsumer({
        workKinds: ['one.work'],
        activate: ({ services }): Contributions => (services.get(GRANTED), { workKinds: list }),
      }),
      fakeGrantedConsumer({ name: 'steady' }),
      fakeExtension({ name: 'late', activate: emptying(list) }),
    ]);
    const result = await host.activate({ signal });

    expect(result.failed.map((failure) => failure.extension)).toEqual(['one']);
    expect(result.active).toEqual(['maker', 'steady', 'late']);
    expect(disarmed).toEqual(['one']);
  });

  it('for every consumer when the provider stops with the host, before the provider deactivates', async () => {
    const during: string[][] = [];
    const { extension, disarmed } = fakeGrantedProvider({
      deactivate: () => void during.push([...disarmed]),
    });
    const host = hostOf([
      extension,
      fakeGrantedConsumer({ name: 'one' }),
      fakeGrantedConsumer({ name: 'two' }),
    ]);

    await host.activate({ signal });
    await host.deactivate();

    expect(disarmed.toSorted()).toEqual(['one', 'two']);
    expect(during).toEqual([['one', 'two']]);
  });

  it('born disarmed: a scope first read after the consumer stopped is already off', async () => {
    let late: (() => GrantedScope) | undefined;
    const { extension, disarmed } = fakeGrantedProvider();
    const host = hostOf([
      extension,
      fakeGrantedConsumer({
        activate: ({ services }) => ((late = () => services.get(GRANTED)), {}),
      }),
    ]);

    await host.activate({ signal });
    await host.deactivate();

    expect(() => late?.().use()).toThrow('deactivated');
    expect(disarmed).toEqual(['one']);
  });
});
