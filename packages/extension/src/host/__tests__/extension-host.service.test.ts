import { describe, expect, it } from 'vitest';
import {
  ContributionCollisionError,
  ExtensionActivationError,
  ExtensionGraphError,
  ExtensionHostStateError,
  MissingServiceError,
} from '../../errors/extension.errors.js';
import type { Contributions, Extension } from '../../extension/extension.types.js';
import { defineService, hostService } from '../../extension/extension.utils.js';
import { fakeExtension, fakeHook, fakeTool } from '../../testing/extension.fake.js';
import { ExtensionHost } from '../extension-host.service.js';

const signal = new AbortController().signal;
const COUNTER = defineService<number>('counter');

/** Two extensions that contribute the same thing, so activating both collides. */
const colliding = (contributes: Contributions): [Extension, Extension] => [
  fakeExtension({ name: 'first', contributes }),
  fakeExtension({ name: 'second', contributes }),
];

describe('ExtensionHost activation', () => {
  it('activates extensions after the ones they depend on, whatever order they are listed in', async () => {
    const log: string[] = [];
    const record = (name: string) => () => {
      log.push(name);

      return {};
    };
    const host = new ExtensionHost({
      extensions: [
        fakeExtension({ name: 'top', dependsOn: ['middle'], activate: record('top') }),
        fakeExtension({ name: 'middle', dependsOn: ['base'], activate: record('middle') }),
        fakeExtension({ name: 'base', activate: record('base') }),
      ],
    });
    const result = await host.activate({ signal });

    expect(log).toEqual(['base', 'middle', 'top']);
    expect(result.active).toEqual(['base', 'middle', 'top']);
  });

  it('merges every extension’s tools, hooks and work kinds in activation order', async () => {
    const host = new ExtensionHost({
      extensions: [
        fakeExtension({ name: 'a', contributes: { tools: [fakeTool('one')] } }),
        fakeExtension({
          name: 'b',
          contributes: {
            tools: [fakeTool('two')],
            hooks: [fakeHook('watch')],
            workKinds: [{ name: 'b.job', description: 'A job', completion: 'finite' }],
          },
        }),
      ],
    });
    const { contributions } = await host.activate({ signal });

    expect(contributions.tools.map((tool) => tool.name)).toEqual(['one', 'two']);
    expect(contributions.hooks.map((hook) => hook.name)).toEqual(['watch']);
    expect(contributions.workKinds.map((kind) => kind.name)).toEqual(['b.job']);
  });

  it('lets an extension read a service its dependency provided', async () => {
    const host = new ExtensionHost({
      extensions: [
        fakeExtension({
          name: 'user',
          dependsOn: ['provider'],
          requires: [COUNTER.name],
          tools: ['count-7'],
          activate: ({ services }) => ({ tools: [fakeTool(`count-${services.get(COUNTER)}`)] }),
        }),
        fakeExtension({
          name: 'provider',
          provides: [COUNTER.name],
          activate: ({ services }) => {
            services.provide(COUNTER, 7);

            return {};
          },
        }),
      ],
    });
    const { contributions } = await host.activate({ signal });

    expect(contributions.tools.map((tool) => tool.name)).toEqual(['count-7']);
  });

  it('keeps activating the others when one extension’s activate throws, and skips what depends on it', async () => {
    const host = new ExtensionHost({
      extensions: [
        fakeExtension({
          name: 'broken',
          activate: () => {
            throw new Error('boom');
          },
        }),
        fakeExtension({ name: 'child', dependsOn: ['broken'] }),
        fakeExtension({ name: 'fine', contributes: { tools: [fakeTool('still-here')] } }),
      ],
    });
    const result = await host.activate({ signal });

    expect(result.active).toEqual(['fine']);
    expect(result.contributions.tools.map((tool) => tool.name)).toEqual(['still-here']);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toBeInstanceOf(ExtensionActivationError);
    expect(result.failed[0]?.message).toContain('broken');
    expect(result.skipped).toEqual([{ extension: 'child', reason: 'dependency' }]);
  });

  it.each([
    ['tool', { tools: [fakeTool('same')] }],
    ['hook', { hooks: [fakeHook('same')] }],
  ])(
    'fails loudly, naming both extensions, when two contribute a %s with one name',
    async (_kind, contribution) => {
      const host = new ExtensionHost({ extensions: colliding(contribution) });

      const caught = await host.activate({ signal }).catch((caughtError: unknown) => caughtError);

      expect(caught).toBeInstanceOf(ContributionCollisionError);
      expect((caught as Error).message).toContain('"same" is contributed by both first and second');
    },
  );

  it('deactivates what it activated when a collision stops the activation', async () => {
    const log: string[] = [];
    const [first, second] = colliding({ tools: [fakeTool('same')] });
    const host = new ExtensionHost({
      extensions: [{ ...first, deactivate: () => void log.push('first') }, second],
    });

    await expect(host.activate({ signal })).rejects.toThrow(ContributionCollisionError);
    expect(log).toEqual(['first']);
  });

  it('throws at construction for a cycle, a missing dependency and a repeated name', () => {
    const build = (extensions: ReturnType<typeof fakeExtension>[]) => () =>
      new ExtensionHost({ extensions });

    expect(
      build([
        fakeExtension({ name: 'a', dependsOn: ['b'] }),
        fakeExtension({ name: 'b', dependsOn: ['a'] }),
      ]),
    ).toThrow(/a -> b -> a/);
    expect(build([fakeExtension({ name: 'a', dependsOn: ['gone'] })])).toThrow(/"gone"/);
    expect(build([fakeExtension({ name: 'a' }), fakeExtension({ name: 'a' })])).toThrow(
      ExtensionGraphError,
    );
  });
});

describe('ExtensionHost services the host supplies', () => {
  const supplied = [hostService({ key: COUNTER, value: 42 })];

  it('lets an extension read a host service without depending on anything, and the app too', async () => {
    const host = new ExtensionHost({
      services: supplied,
      extensions: [
        fakeExtension({
          name: 'reader',
          requires: [COUNTER.name],
          tools: ['count-42'],
          activate: ({ services }) => ({ tools: [fakeTool(`count-${services.get(COUNTER)}`)] }),
        }),
      ],
    });
    const { contributions } = await host.activate({ signal });

    expect(contributions.tools.map((tool) => tool.name)).toEqual(['count-42']);
    expect(host.service(COUNTER)).toBe(42);
  });

  it('fails an extension that provides a key the host supplies, naming the host and the extension', async () => {
    const host = new ExtensionHost({
      services: supplied,
      extensions: [
        fakeExtension({
          name: 'rival',
          provides: [COUNTER.name],
          activate: ({ services }) => {
            services.provide(COUNTER, 1);

            return {};
          },
        }),
      ],
    });
    const result = await host.activate({ signal });

    expect(result.active).toEqual([]);
    expect(result.failed[0]?.cause).toBeInstanceOf(ContributionCollisionError);
    expect(result.failed[0]?.message).toContain('both the host and rival');
  });

  it('lets an extension find an optional service, undefined when nobody provides it', async () => {
    let found: number | undefined = -1;
    const host = new ExtensionHost({
      extensions: [
        fakeExtension({
          name: 'reader',
          optional: [COUNTER.name],
          activate: ({ services }) => {
            found = services.find(COUNTER);

            return {};
          },
        }),
      ],
    });

    await host.activate({ signal });
    expect(found).toBeUndefined();
  });
});

describe('ExtensionHost trust', () => {
  const project = fakeExtension({
    name: 'from-repo',
    origin: 'project',
    contributes: { tools: [fakeTool('repo-tool')] },
  });

  it('skips a project extension unless the workspace is trusted', async () => {
    const host = new ExtensionHost({ extensions: [project] });
    const result = await host.activate({ signal });

    expect(result.active).toEqual([]);
    expect(result.skipped).toEqual([{ extension: 'from-repo', reason: 'untrusted' }]);
  });

  it('activates a project extension once its code is trusted, and never asks about builtin ones', async () => {
    const asked: string[] = [];
    const host = new ExtensionHost({
      extensions: [fakeExtension({ name: 'builtin' }), project],
      isTrusted: (extension) => {
        asked.push(extension.name);

        return true;
      },
    });
    const result = await host.activate({ signal });

    expect(result.active).toEqual(['builtin', 'from-repo']);
    expect(asked).toEqual(['from-repo']);
  });

  it('treats an origin it does not know as code to trust first, not as builtin', async () => {
    const unknown = fakeExtension({
      name: 'odd',
      // A JavaScript caller can pass what the type forbids; it must not skip the gate.
      origin: 'elsewhere' as unknown as 'project',
    });
    const result = await new ExtensionHost({ extensions: [unknown] }).activate({ signal });

    expect(result.active).toEqual([]);
    expect(result.skipped).toEqual([{ extension: 'odd', reason: 'untrusted' }]);
  });
});

describe('ExtensionHost deactivation', () => {
  it('deactivates in reverse activation order, once, and keeps going when one throws', async () => {
    const log: string[] = [];
    const record = (name: string) => () => void log.push(name);
    const host = new ExtensionHost({
      extensions: [
        fakeExtension({ name: 'base', deactivate: record('base') }),
        fakeExtension({
          name: 'middle',
          dependsOn: ['base'],
          deactivate: () => {
            throw new Error('stuck');
          },
        }),
        fakeExtension({ name: 'top', dependsOn: ['middle'], deactivate: record('top') }),
      ],
    });

    await host.activate({ signal });

    const errors = await host.deactivate();

    expect(log).toEqual(['top', 'base']);
    expect(errors).toHaveLength(1);
    expect(await host.deactivate()).toEqual([]);
    expect(log).toEqual(['top', 'base']);
  });

  it('does not deactivate an extension that never activated', async () => {
    const log: string[] = [];
    const host = new ExtensionHost({
      extensions: [
        fakeExtension({
          name: 'broken',
          activate: () => {
            throw new Error('boom');
          },
          deactivate: () => void log.push('broken'),
        }),
      ],
    });

    await host.activate({ signal });
    await host.deactivate();
    expect(log).toEqual([]);
  });
});

describe('ExtensionHost lifecycle', () => {
  it('activates once per session: a second activate, or one after close, throws', async () => {
    const host = new ExtensionHost({
      extensions: [fakeExtension({ name: 'a' })],
    });

    await host.activate({ signal });
    await expect(host.activate({ signal })).rejects.toThrow(ExtensionHostStateError);
    await host.deactivate();
    await expect(host.activate({ signal })).rejects.toThrow(/closed/);
  });

  describe('when deactivate runs while activate is still running', () => {
    /** `fast` activated; `slow` is still activating, held until `finish`; `later` waits behind it. */
    function holdSlow(slowDeactivate?: () => void) {
      const log: string[] = [];
      const started = Promise.withResolvers<undefined>();
      const finish = Promise.withResolvers<undefined>();
      const host = new ExtensionHost({
        extensions: [
          fakeExtension({
            name: 'fast',
            contributes: { tools: [fakeTool('fast-tool')] },
            deactivate: () => void log.push('fast deactivated'),
          }),
          fakeExtension({
            name: 'slow',
            dependsOn: ['fast'],
            tools: ['slow-tool'],
            activate: async () => {
              log.push('slow starts');
              started.resolve(undefined);
              await finish.promise;

              return { tools: [fakeTool('slow-tool')] };
            },
            deactivate:
              slowDeactivate ??
              (() => {
                log.push('slow deactivated');
              }),
          }),
          fakeExtension({
            name: 'later',
            dependsOn: ['slow'],
            activate: () => {
              log.push('later starts');

              return {};
            },
          }),
        ],
      });

      return { log, host, started, finish };
    }

    it('stops the rest, deactivates what finished meanwhile, and reports nothing running', async () => {
      const { log, host, started, finish } = holdSlow();
      const activating = host.activate({ signal });

      await started.promise;
      expect(await host.deactivate()).toEqual([]);
      finish.resolve(undefined);

      const result = await activating;

      expect(result.active).toEqual([]);
      expect(result.contributions.tools).toEqual([]);
      expect(log).toEqual(['slow starts', 'fast deactivated', 'slow deactivated']);
    });

    it('keeps the error of an extension that finished late and could not deactivate, without throwing it', async () => {
      const { host, started, finish } = holdSlow(() => {
        throw new Error('slow cannot close');
      });
      const activating = host.activate({ signal });

      await started.promise;
      await host.deactivate();
      finish.resolve(undefined);

      const result = await activating;

      expect(result.lateDeactivationErrors).toHaveLength(1);
      expect(String(result.lateDeactivationErrors[0])).toContain('slow cannot close');
    });
  });

  it('stops an activation whose signal aborts during the last extension, not only between two', async () => {
    const log: string[] = [];
    const controller = new AbortController();
    const host = new ExtensionHost({
      extensions: [
        fakeExtension({
          name: 'only',
          activate: () => {
            controller.abort(new Error('session ended'));

            return {};
          },
          deactivate: () => void log.push('only deactivated'),
        }),
      ],
    });

    await expect(host.activate({ signal: controller.signal })).rejects.toThrow('session ended');
    expect(log).toEqual(['only deactivated']);
  });

  it('stops on an aborted signal, deactivates what activated and throws the reason', async () => {
    const log: string[] = [];
    const controller = new AbortController();
    const host = new ExtensionHost({
      extensions: [
        fakeExtension({
          name: 'first',
          activate: () => {
            controller.abort(new Error('session ended'));

            return {};
          },
          deactivate: () => void log.push('first'),
        }),
        fakeExtension({
          name: 'second',
          dependsOn: ['first'],
          activate: () => {
            log.push('second starts');

            return {};
          },
        }),
      ],
    });

    await expect(host.activate({ signal: controller.signal })).rejects.toThrow('session ended');
    expect(log).toEqual(['first']);
  });

  it('counts a throwing trust check as that extension failing, not the whole activation', async () => {
    const host = new ExtensionHost({
      extensions: [
        fakeExtension({ name: 'builtin', contributes: { tools: [fakeTool('kept')] } }),
        fakeExtension({ name: 'from-repo', origin: 'project' }),
      ],
      isTrusted: () => {
        throw new Error('trust store unreadable');
      },
    });
    const result = await host.activate({ signal });

    expect(result.active).toEqual(['builtin']);
    expect(result.failed.map((error) => error.extension)).toEqual(['from-repo']);
  });

  it('drops the services of an extension whose activate threw after providing them', async () => {
    const host = new ExtensionHost({
      extensions: [
        fakeExtension({
          name: 'half',
          provides: [COUNTER.name],
          activate: ({ services }) => {
            services.provide(COUNTER, 1);

            throw new Error('boom');
          },
        }),
      ],
    });

    await host.activate({ signal });
    expect(() => host.service(COUNTER)).toThrow(MissingServiceError);
  });
});
