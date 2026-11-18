import { describe, expect, it } from 'vitest';
import { ExtensionActivationError } from '../../errors/extension.errors.js';
import { ExtensionGrantError } from '../../errors/manifest.errors.js';
import { defineService, hostService, hostServiceFor } from '../../extension/extension.utils.js';
import type { FakeExtensionFields } from '../../testing/extension-fake.types.js';
import { fakeExtension, fakeTool } from '../../testing/extension.fake.js';
import { ExtensionHost } from '../extension-host.service.js';

const signal = new AbortController().signal;
const TASKS = defineService<object>('background-tasks');
const OUTPUTS = defineService<object>('output-reader');
const PLAIN = defineService<number>('plain');

const supplied = [
  hostServiceFor({
    key: TASKS,
    grants: ['task:start', 'task:read'],
    create: () => ({ value: {} }),
  }),
  hostServiceFor({ key: OUTPUTS, grants: ['output:read'], create: () => ({ value: {} }) }),
  hostService({ key: PLAIN, value: 1 }),
];

/** What activating `extensions` over the supplied services gives. */
async function activate(params: { extensions: FakeExtensionFields[]; services?: typeof supplied }) {
  const host = new ExtensionHost({
    extensions: params.extensions.map((fields) => fakeExtension(fields)),
    services: params.services ?? supplied,
  });

  return host.activate({ signal });
}

describe('ExtensionHost verifies manifest grants against the supplied services', () => {
  it('activates an extension whose grants a readable service offers', async () => {
    const result = await activate({
      extensions: [
        {
          name: 'ok',
          requires: [TASKS.name],
          optional: [OUTPUTS.name],
          grants: ['task:start', 'output:read'],
        },
      ],
    });

    expect(result.failed).toEqual([]);
    expect(result.active).toEqual(['ok']);
  });

  it('activates an extension with no grants, even over services that declare some', async () => {
    const result = await activate({ extensions: [{ name: 'plain' }] });

    expect(result.active).toEqual(['plain']);
  });

  it('fails a grant no supplied service offers (a typo), naming the extension and the grant', async () => {
    const result = await activate({
      extensions: [
        { name: 'typo', requires: [TASKS.name], grants: ['task:strat'] },
        { name: 'child', dependsOn: ['typo'] },
        { name: 'fine', contributes: { tools: [fakeTool('kept')] } },
      ],
    });
    const [failed] = result.failed;

    expect(result.failed).toHaveLength(1);
    expect(failed).toBeInstanceOf(ExtensionActivationError);
    expect(failed?.cause).toBeInstanceOf(ExtensionGrantError);
    expect(failed?.cause).toMatchObject({ extension: 'typo', grant: 'task:strat' });
    expect((failed?.cause as Error).message).toContain('Extension typo');
    expect((failed?.cause as Error).message).toContain('"task:strat"');
    expect(result.active).toEqual(['fine']);
    expect(result.skipped).toEqual([{ extension: 'child', reason: 'dependency' }]);
    expect(result.contributions.tools.map((tool) => tool.name)).toEqual(['kept']);
  });

  it('fails a grant whose service the extension does not list in requires or optional', async () => {
    const result = await activate({
      extensions: [{ name: 'blind', requires: [TASKS.name], grants: ['output:read'] }],
    });

    expect(result.failed[0]?.cause).toBeInstanceOf(ExtensionGrantError);
    expect(result.failed[0]?.cause).toMatchObject({ extension: 'blind', grant: 'output:read' });
    expect((result.failed[0]?.cause as Error).message).toContain('"output-reader"');
  });

  it('fails before activate runs', async () => {
    let ran = false;
    const result = await activate({
      extensions: [
        {
          name: 'typo',
          grants: ['nope:nope'],
          activate: () => {
            ran = true;

            return {};
          },
        },
      ],
    });

    expect(result.failed).toHaveLength(1);
    expect(ran).toBe(false);
  });

  it('builds the catalogue only from the services supplied: a plain value declares no grants', async () => {
    const result = await activate({
      extensions: [{ name: 'asks', requires: [PLAIN.name], grants: ['task:read'] }],
      services: [hostService({ key: PLAIN, value: 1 })],
    });

    expect(result.failed[0]?.cause).toMatchObject({ extension: 'asks', grant: 'task:read' });
  });

  it('does not know a grant of a service the host did not supply', async () => {
    const result = await activate({
      extensions: [{ name: 'asks', grants: ['output:read'] }],
      services: supplied.slice(0, 1),
    });

    expect(result.failed[0]?.cause).toMatchObject({ grant: 'output:read' });
  });

  it('does not offer a grant a dependency provides: only host services define grants', async () => {
    const result = await activate({
      extensions: [
        {
          name: 'maker',
          provides: ['made'],
          activate: ({ services }) => {
            services.provide(defineService<number>('made'), 1);

            return {};
          },
        },
        { name: 'asks', dependsOn: ['maker'], requires: ['made'], grants: ['made:use'] },
      ],
    });

    expect(result.failed[0]?.cause).toBeInstanceOf(ExtensionGrantError);
  });
});
