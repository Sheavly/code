import { describe, expect, it } from 'vitest';
import { ExtensionActivationError, MissingServiceError } from '../../errors/extension.errors.js';
import { ExtensionUndeclaredError } from '../../errors/manifest.errors.js';
import type { Contributions, Services } from '../../extension/extension.types.js';
import { defineService, hostService, placeHook } from '../../extension/extension.utils.js';
import type { FakeExtensionFields } from '../../testing/extension-fake.types.js';
import { fakeExtension, fakeHook, fakeTool } from '../../testing/extension.fake.js';
import { ExtensionHost } from '../extension-host.service.js';

const signal = new AbortController().signal;
const COUNTER = defineService<number>('counter');

/** The one failure of a host with `extensions`, and what else activated, skipped and was left. */
async function failureOf(params: {
  extensions: FakeExtensionFields[];
  services?: ReturnType<typeof hostService>[];
}) {
  const host = new ExtensionHost({
    extensions: params.extensions.map((fields) => fakeExtension(fields)),
    services: params.services,
  });
  const result = await host.activate({ signal });
  const [failed] = result.failed;

  expect(result.failed).toHaveLength(1);
  expect(failed).toBeInstanceOf(ExtensionActivationError);
  expect(failed?.cause).toBeInstanceOf(ExtensionUndeclaredError);

  return { host, result, cause: failed?.cause as ExtensionUndeclaredError };
}

describe('ExtensionHost holds a service use to the manifest', () => {
  const supplied = [hostService({ key: COUNTER, value: 1 })];

  it.each([
    ['get', 'service get', (services: Services) => services.get(COUNTER)],
    ['find', 'service find', (services: Services) => services.find(COUNTER)],
  ])(
    'fails an extension that calls services.%s for a service it does not declare',
    async (_name, use, call) => {
      const { cause, result } = await failureOf({
        services: supplied,
        extensions: [
          {
            name: 'nosy',
            activate: ({ services }) => {
              call(services);

              return {};
            },
          },
          { name: 'child', dependsOn: ['nosy'] },
          { name: 'fine', contributes: { tools: [fakeTool('kept')] } },
        ],
      });

      expect(cause).toMatchObject({ extension: 'nosy', use, undeclared: 'counter' });
      expect(cause.message).toContain('Extension nosy uses');
      expect(result.active).toEqual(['fine']);
      expect(result.skipped).toEqual([{ extension: 'child', reason: 'dependency' }]);
      expect(result.contributions.tools.map((tool) => tool.name)).toEqual(['kept']);
    },
  );

  it('fails an extension that provides a service its manifest does not list in provides', async () => {
    const { cause, host } = await failureOf({
      extensions: [
        {
          name: 'sneaky',
          activate: ({ services }) => {
            services.provide(COUNTER, 3);

            return {};
          },
        },
      ],
    });

    expect(cause).toMatchObject({ extension: 'sneaky', use: 'service provide' });
    expect(() => host.service(COUNTER)).toThrow(MissingServiceError);
  });

  it('allows a get of a service listed only as optional, and a find of one listed as required', async () => {
    const host = new ExtensionHost({
      services: supplied,
      extensions: [
        fakeExtension({
          name: 'reader',
          optional: [COUNTER.name],
          activate: ({ services }) => {
            services.get(COUNTER);

            return {};
          },
        }),
        fakeExtension({
          name: 'finder',
          requires: [COUNTER.name],
          activate: ({ services }) => {
            services.find(COUNTER);

            return {};
          },
        }),
      ],
    });
    const result = await host.activate({ signal });

    expect(result.failed).toEqual([]);
    expect(result.active).toEqual(['reader', 'finder']);
  });

  it('keeps the error for a service read from a non-dependency when the service is declared', async () => {
    const host = new ExtensionHost({
      extensions: [
        fakeExtension({
          name: 'provider',
          provides: [COUNTER.name],
          activate: ({ services }) => {
            services.provide(COUNTER, 1);

            return {};
          },
        }),
        fakeExtension({
          name: 'stranger',
          optional: [COUNTER.name],
          activate: ({ services }) => {
            services.get(COUNTER);

            return {};
          },
        }),
      ],
    });
    const result = await host.activate({ signal });

    expect(result.failed[0]?.cause).toBeInstanceOf(MissingServiceError);
  });
});

describe('ExtensionHost holds what an extension contributes to the manifest', () => {
  const cases: [string, Contributions, string][] = [
    ['tool', { tools: [fakeTool('extra')] }, 'tool "extra"'],
    ['hook', { hooks: [fakeHook('extra')] }, 'hook "extra"'],
    [
      'placed hook (by its inner hook’s name)',
      { hooks: [placeHook({ hook: fakeHook('extra'), before: ['other'] })] },
      'hook "extra"',
    ],
    [
      'work kind',
      { workKinds: [{ name: 'a.extra', description: 'x', completion: 'finite' }] },
      'work kind "a.extra"',
    ],
  ];

  it.each(cases)(
    'fails an extension that contributes an undeclared %s, deactivating it and dropping its services',
    async (_kind, contribution, described) => {
      const log: string[] = [];
      const { cause, host, result } = await failureOf({
        extensions: [
          {
            name: 'a',
            provides: [COUNTER.name],
            activate: ({ services }) => {
              services.provide(COUNTER, 5);

              return contribution;
            },
            deactivate: () => void log.push('a deactivated'),
          },
          { name: 'child', dependsOn: ['a'] },
          { name: 'fine', contributes: { tools: [fakeTool('kept')] } },
        ],
      });

      expect(cause.message).toContain(`Extension a uses ${described}`);
      expect(cause.extension).toBe('a');
      expect(log).toEqual(['a deactivated']);
      expect(() => host.service(COUNTER)).toThrow(MissingServiceError);
      expect(result.active).toEqual(['fine']);
      expect(result.skipped).toEqual([{ extension: 'child', reason: 'dependency' }]);
      expect(result.contributions.tools.map((tool) => tool.name)).toEqual(['kept']);
      expect(result.contributions.hooks).toEqual([]);
      expect(result.contributions.workKinds).toEqual([]);
      await host.deactivate();
      expect(log).toEqual(['a deactivated']);
    },
  );

  it('keeps the error of a deactivate that throws while stopping an undeclared extension', async () => {
    const { result } = await failureOf({
      extensions: [
        {
          name: 'a',
          activate: () => ({ tools: [fakeTool('extra')] }),
          deactivate: () => {
            throw new Error('cannot close');
          },
        },
      ],
    });

    expect(String(result.lateDeactivationErrors[0])).toContain('cannot close');
  });

  it('does not deactivate an extension that failed by throwing inside activate', async () => {
    const log: string[] = [];

    await failureOf({
      services: [hostService({ key: COUNTER, value: 1 })],
      extensions: [
        {
          name: 'nosy',
          activate: ({ services }) => {
            services.get(COUNTER);

            return {};
          },
          deactivate: () => void log.push('nosy deactivated'),
        },
      ],
    });
    expect(log).toEqual([]);
  });

  it('accepts names it declared but did not contribute: some are contributed only under options', async () => {
    const host = new ExtensionHost({
      extensions: [
        fakeExtension({
          name: 'a',
          tools: ['maybe', 'used'],
          hooks: ['maybe-hook'],
          workKinds: ['a.maybe'],
          contributes: { tools: [fakeTool('used')] },
        }),
      ],
    });
    const result = await host.activate({ signal });

    expect(result.failed).toEqual([]);
    expect(result.contributions.tools.map((tool) => tool.name)).toEqual(['used']);
  });

  it('accepts a contribution a wildcard entry covers, and fails one it does not', async () => {
    const run = (hookName: string) =>
      new ExtensionHost({
        extensions: [
          fakeExtension({
            name: 'a',
            tools: ['a_*'],
            hooks: ['project.*'],
            workKinds: ['a.*'],
            activate: () => ({
              tools: [fakeTool('a_one')],
              hooks: [fakeHook(hookName)],
              workKinds: [{ name: 'a.job', description: 'x', completion: 'finite' }],
            }),
          }),
        ],
      }).activate({ signal });
    const covered = await run('project.audit');
    const missed = await run('audit');

    expect(covered.failed).toEqual([]);
    expect(covered.contributions.hooks.map((hook) => hook.name)).toEqual(['project.audit']);
    expect(missed.failed[0]?.cause).toMatchObject({ use: 'hook', undeclared: 'audit' });
  });

  it('lets a bare * in hooks cover any hook name, but not a tool', async () => {
    const run = (contributes: Contributions) =>
      new ExtensionHost({
        extensions: [fakeExtension({ name: 'a', hooks: ['*'], activate: () => contributes })],
      }).activate({ signal });
    const hooks = await run({ hooks: [fakeHook('whatever'), fakeHook('else')] });
    const tool = await run({ tools: [fakeTool('whatever')] });

    expect(hooks.failed).toEqual([]);
    expect(tool.failed[0]?.cause).toMatchObject({ use: 'tool', undeclared: 'whatever' });
  });

  it('accepts what it contributes when it declares exactly that', async () => {
    const host = new ExtensionHost({
      extensions: [
        fakeExtension({
          name: 'a',
          contributes: {
            tools: [fakeTool('one')],
            hooks: [placeHook({ hook: fakeHook('watch') })],
            workKinds: [{ name: 'a.job', description: 'x', completion: 'service' }],
          },
        }),
      ],
    });
    const result = await host.activate({ signal });

    expect(result.failed).toEqual([]);
    expect(result.active).toEqual(['a']);
  });
});
