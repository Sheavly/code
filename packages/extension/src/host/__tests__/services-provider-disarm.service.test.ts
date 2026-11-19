import { describe, expect, it } from 'vitest';
import type { Extension, ServiceConsumer } from '../../extension/extension.types.js';
import { defineService } from '../../extension/extension.utils.js';
import { fakeExtension } from '../../testing/extension.fake.js';
import { ServiceRegistry } from '../services.service.js';

const SCOPE = defineService<{ owner: string }>('scoped');

function consumerOf(extension: Extension): ServiceConsumer {
  return { name: extension.name, manifest: extension.manifest, contributedTools: () => [] };
}

/** A registry where `maker` provides `SCOPE` per consumer, and `one` and `two` read it. */
function rig() {
  const disarmed: string[] = [];
  const registry = new ServiceRegistry();
  const maker = fakeExtension({ name: 'maker', provides: [SCOPE.name] });

  registry.viewFor({ extension: consumerOf(maker), readable: new Set(['maker']) }).provideFor({
    key: SCOPE,
    create: (consumer) => ({
      value: { owner: consumer.name },
      disarm: () => void disarmed.push(consumer.name),
    }),
  });

  const reader = (name: string) =>
    registry.viewFor({
      extension: consumerOf(fakeExtension({ name, dependsOn: ['maker'], requires: [SCOPE.name] })),
      readable: new Set(['maker', name]),
    });

  return { registry, disarmed, reader };
}

describe('ServiceRegistry disarms what a provider handed out when the provider ends', () => {
  it('disarms every scope the provider handed out', () => {
    const { registry, disarmed, reader } = rig();

    reader('one').get(SCOPE);
    reader('two').get(SCOPE);
    registry.disarm('maker');

    expect(disarmed.toSorted()).toEqual(['one', 'two']);
  });

  it('disarms only the consumer own scope when a consumer ends', () => {
    const { registry, disarmed, reader } = rig();

    reader('one').get(SCOPE);
    reader('two').get(SCOPE);
    registry.disarm('one');

    expect(disarmed).toEqual(['one']);
  });

  it('runs each disarm once however many ends reach the scope', () => {
    const { registry, disarmed, reader } = rig();

    reader('one').get(SCOPE);
    registry.disarm('one');
    registry.disarm('maker');
    registry.disarm('maker');
    registry.disarmAll();

    expect(disarmed).toEqual(['one']);
  });

  it('disarms at birth a scope built after its provider ended', () => {
    const { registry, disarmed, reader } = rig();

    registry.disarm('maker');
    reader('late').get(SCOPE);

    expect(disarmed).toEqual(['late']);
  });
});
