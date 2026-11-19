import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContributionCollisionError } from '../../errors/extension.errors.js';
import type { ServiceConsumer } from '../../extension/extension.types.js';
import { fakeExtension, fakeTool } from '../../testing/extension.fake.js';
import { FAKE_SCOPE, fakeScopeFactory } from '../../testing/service-factory.fake.js';
import type { mergeContributions } from '../contributions.utils.js';
import { ExtensionHost } from '../extension-host.service.js';

type Probe = {
  /** The consumers the host built, filled while it activates. */
  consumers: ServiceConsumer[];
  /** What each one's accessor held at the moment the merge ran. */
  atMerge: (readonly string[])[][];
};

const probe: Probe = vi.hoisted(() => ({ consumers: [], atMerge: [] }));

vi.mock('../contributions.utils.js', async (importOriginal) => {
  const actual = await importOriginal<{ mergeContributions: typeof mergeContributions }>();

  return {
    ...actual,
    mergeContributions: (...args: Parameters<typeof mergeContributions>) => {
      probe.atMerge.push(probe.consumers.map((consumer) => consumer.contributedTools()));

      return actual.mergeContributions(...args);
    },
  };
});

const signal = new AbortController().signal;

/** Two extensions that each read the fake scope and contribute one tool. */
function twoContributing(params: { first: string; second: string }) {
  const factory = fakeScopeFactory();
  const contributing = (name: string, tool: string) =>
    fakeExtension({
      name,
      requires: [FAKE_SCOPE.name],
      tools: [tool],
      activate: ({ services }) => (services.get(FAKE_SCOPE), { tools: [fakeTool(tool)] }),
    });

  probe.consumers = factory.built;

  return new ExtensionHost({
    extensions: [contributing('one', params.first), contributing('two', params.second)],
    services: [factory.service],
  });
}

describe('the merge that checks collisions', () => {
  beforeEach(() => {
    probe.consumers = [];
    probe.atMerge = [];
  });

  it('runs once, with no extension attributable yet, and then they are all merged together', async () => {
    const host = twoContributing({ first: 'one.a', second: 'two.b' });

    await host.activate({ signal });

    expect(probe.atMerge).toEqual([[[], []]]);
    expect(probe.consumers.map((consumer) => consumer.contributedTools())).toEqual([
      ['one.a'],
      ['two.b'],
    ]);
  });

  it('fails the whole activation on a collision, and neither accessor ever held the name', async () => {
    const host = twoContributing({ first: 'shared', second: 'shared' });

    await expect(host.activate({ signal })).rejects.toBeInstanceOf(ContributionCollisionError);

    expect(probe.atMerge).toEqual([[[], []]]);
    expect(probe.consumers.map((consumer) => consumer.contributedTools())).toEqual([[], []]);
  });
});
