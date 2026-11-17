import { describe, expect, it } from 'vitest';
import {
  ExtensionActivationError,
  ExtensionContributionChangedError,
  MissingServiceError,
} from '../../errors/extension.errors.js';
import type { Contributions, HookContribution } from '../../extension/extension.types.js';
import { defineService, placeHook } from '../../extension/extension.utils.js';
import { fakeExtension, fakeHook, fakeTool } from '../../testing/extension.fake.js';
import { ExtensionHost } from '../extension-host.service.js';

const signal = new AbortController().signal;
const COUNTER = defineService<number>('counter');

/** A copy of `value` whose `name` reads `first` for `reads` reads (default one) and `later` after that. */
function renamedAfterReads<TValue extends { name: string }>(params: {
  value: TValue;
  first: string;
  later: string;
  reads?: number;
}): TValue {
  const { reads: limit = 1 } = params;
  const copy = { ...params.value };
  let reads = 0;

  Object.defineProperty(copy, 'name', {
    enumerable: true,
    get: () => (reads++ < limit ? params.first : params.later),
  });

  return copy;
}

/**
 * Runs `a`, which returns `returned` and provides a service, then its dependent `child`, then
 * `late`, whose `activate` calls `change` (the extension `a` keeps its references to what it
 * returned, so this stands for anything that touches them after the check).
 */
async function runWithChangeAfterCheck(params: {
  declared: { tools?: string[]; hooks?: string[] };
  returned: () => Contributions;
  change: () => void;
}) {
  const log: string[] = [];
  const host = new ExtensionHost({
    extensions: [
      fakeExtension({
        name: 'a',
        ...params.declared,
        provides: [COUNTER.name],
        activate: ({ services }) => {
          services.provide(COUNTER, 1);

          return params.returned();
        },
        deactivate: () => void log.push('a deactivated'),
      }),
      fakeExtension({
        name: 'child',
        dependsOn: ['a'],
        contributes: { tools: [fakeTool('child-tool')] },
        deactivate: () => void log.push('child deactivated'),
      }),
      fakeExtension({
        name: 'late',
        activate: () => {
          params.change();

          return { tools: [fakeTool('kept')] };
        },
        tools: ['kept'],
      }),
    ],
  });
  const result = await host.activate({ signal });

  return { host, log, result };
}

/** What every case below must show: the extension failed loudly and rolled back. */
function expectRolledBack(outcome: Awaited<ReturnType<typeof runWithChangeAfterCheck>>) {
  const { host, log, result } = outcome;
  const [failed] = result.failed;

  expect(result.failed).toHaveLength(1);
  expect(failed).toBeInstanceOf(ExtensionActivationError);
  expect(failed?.cause).toBeInstanceOf(ExtensionContributionChangedError);
  expect(failed?.message).toContain('Extension a');
  expect(failed?.extension).toBe('a');
  expect(log).toEqual(['child deactivated', 'a deactivated']);
  expect(() => host.service(COUNTER)).toThrow(MissingServiceError);
  expect(result.active).toEqual(['late']);
  expect(result.skipped).toEqual([{ extension: 'child', reason: 'dependency' }]);
  expect(result.contributions.tools.map((tool) => tool.name)).toEqual(['kept']);
  expect(result.contributions.hooks).toEqual([]);

  return failed?.cause as ExtensionContributionChangedError;
}

describe('ExtensionHost merges only what it checked', () => {
  it('fails an extension that pushes an undeclared tool into its returned array after activation', async () => {
    const list = [fakeTool('one')];
    const cause = expectRolledBack(
      await runWithChangeAfterCheck({
        declared: { tools: ['one'] },
        returned: () => ({ tools: list }),
        change: () => void list.push(fakeTool('undeclared')),
      }),
    );

    expect(cause.contribution).toBe('tool');
    expect(cause.message).toContain('from 1 to 2');
  });

  it('fails an extension that replaces an entry of its returned array after the check', async () => {
    const list = [fakeTool('one')];
    const cause = expectRolledBack(
      await runWithChangeAfterCheck({
        declared: { tools: ['one', 'two'] },
        returned: () => ({ tools: list }),
        change: () => void list.splice(0, 1, fakeTool('two')),
      }),
    );

    expect(cause.message).toContain('entry 0 ("one") was replaced');
  });

  it('fails an extension whose tool name is a getter that returns another name after the check', async () => {
    const tool = renamedAfterReads({
      value: fakeTool('declared'),
      first: 'declared',
      later: 'undeclared',
    });
    const cause = expectRolledBack(
      await runWithChangeAfterCheck({
        declared: { tools: ['declared'] },
        returned: () => ({ tools: [tool] }),
        change: () => undefined,
      }),
    );

    expect(cause.message).toContain('"declared" is now named "undeclared"');
  });

  it('fails an extension whose hook, placed, changes its name after the check', async () => {
    const hook = renamedAfterReads({
      value: fakeHook('declared'),
      first: 'declared',
      later: 'declared-too',
    });
    const cause = expectRolledBack(
      await runWithChangeAfterCheck({
        declared: { hooks: ['declared', 'declared-too'] },
        returned: () => ({ hooks: [placeHook({ hook, before: ['x'] })] }),
        change: () => undefined,
      }),
    );

    expect(cause.contribution).toBe('hook');
  });

  it('fails an extension that swaps the returned list for another after the check', async () => {
    const returned = { tools: [fakeTool('one')] };
    const cause = expectRolledBack(
      await runWithChangeAfterCheck({
        declared: { tools: ['one'] },
        returned: () => returned,
        change: () => {
          returned.tools = [fakeTool('one'), fakeTool('undeclared')];
        },
      }),
    );

    expect(cause.message).toContain('the list was replaced');
  });

  it('does not let a later change to a placed hook’s constraints reorder the merged hooks', async () => {
    const first = fakeHook('first');
    const second = fakeHook('second');
    const before = ['first'];
    const contributions: HookContribution[] = [first, placeHook({ hook: second, before })];
    const host = new ExtensionHost({
      extensions: [
        fakeExtension({
          name: 'a',
          hooks: ['first', 'second'],
          activate: () => ({ hooks: contributions }),
        }),
        fakeExtension({
          name: 'late',
          activate: () => {
            before.splice(0);

            return {};
          },
        }),
      ],
    });
    const result = await host.activate({ signal });

    expect(result.failed).toEqual([]);
    expect(result.contributions.hooks.map((hook) => hook.name)).toEqual(['second', 'first']);
  });
});

/** The values of a name that reads `declared` for ten reads (enough to pass every check), then `other`. */
function lateRename<TValue extends { name: string }>(value: TValue): TValue {
  return renamedAfterReads({ value, first: 'declared', later: 'other', reads: 10 });
}

describe('ExtensionHost merges the recorded names, not what the objects say later', () => {
  it.each([
    ['tool', 'tools', lateRename(fakeTool('declared')), fakeTool('other')],
    ['hook', 'hooks', lateRename(fakeHook('declared')), fakeHook('other')],
    [
      'work kind',
      'workKinds',
      lateRename({ name: 'declared', description: 'd', completion: 'finite' as const }),
      { name: 'other', description: 'o', completion: 'finite' as const },
    ],
  ] as const)(
    'does not collide a %s whose name getter turns into another extension’s name after the check',
    async (_label, kind, shifty, other) => {
      const host = new ExtensionHost({
        extensions: [
          fakeExtension({
            name: 'a',
            [kind]: ['declared'],
            activate: () => ({ [kind]: [shifty] }),
          }),
          fakeExtension({ name: 'b', contributes: { [kind]: [other] } }),
        ],
      });
      const result = await host.activate({ signal });
      const merged: readonly unknown[] = result.contributions[kind];

      expect(result.failed).toEqual([]);
      expect(merged).toHaveLength(2);
      expect(merged).toContain(shifty);
    },
  );

  it('orders hooks by their recorded names even when a name getter later says another', async () => {
    const first = fakeHook('a');
    const shifty = renamedAfterReads({
      value: fakeHook('p'),
      first: 'p',
      later: 'a',
      reads: 10,
    });
    const host = new ExtensionHost({
      extensions: [
        fakeExtension({ name: 'one', contributes: { hooks: [first] } }),
        fakeExtension({
          name: 'two',
          hooks: ['p'],
          activate: () => ({ hooks: [placeHook({ hook: shifty, before: ['a'] })] }),
        }),
      ],
    });
    const result = await host.activate({ signal });

    expect(result.failed).toEqual([]);
    expect(result.contributions.hooks).toEqual([shifty, first]);
    expect(result.contributions.hooks[0]).toBe(shifty);
  });
});

describe('ExtensionHost checks and merges with nothing in between', () => {
  it('catches a list that another extension’s deactivate changes during a roll-back', async () => {
    const list = [fakeTool('one')];
    const changer = [fakeTool('changer')];
    const log: string[] = [];
    const host = new ExtensionHost({
      extensions: [
        fakeExtension({
          name: 'changed',
          activate: () => ({ tools: changer }),
          tools: ['changer'],
          deactivate: () => {
            // Runs during the roll-back, after the survivors were checked once.
            list.push(fakeTool('undeclared'));
            log.push('changed deactivated');
          },
        }),
        fakeExtension({
          name: 'survivor',
          tools: ['one'],
          activate: () => ({ tools: list }),
          deactivate: () => void log.push('survivor deactivated'),
        }),
        fakeExtension({
          name: 'late',
          tools: ['kept'],
          activate: () => {
            changer.push(fakeTool('undeclared-too'));

            return { tools: [fakeTool('kept')] };
          },
        }),
      ],
    });
    const result = await host.activate({ signal });

    expect(result.failed.map(({ extension }) => extension)).toEqual(['changed', 'survivor']);
    expect(result.failed[1]?.cause).toBeInstanceOf(ExtensionContributionChangedError);
    expect(result.active).toEqual(['late']);
    expect(result.contributions.tools.map((tool) => tool.name)).toEqual(['kept']);
    expect(log).toEqual(['changed deactivated', 'survivor deactivated']);
  });

  it('deactivates each extension once when deactivate() runs during a roll-back', async () => {
    const counts: Record<string, number> = { a: 0, b: 0, late: 0 };
    const changer = [fakeTool('one')];
    let closing: Promise<readonly unknown[]> | undefined;
    const counted = (name: string) => () => void (counts[name] = (counts[name] ?? 0) + 1);
    const host: ExtensionHost = new ExtensionHost({
      extensions: [
        fakeExtension({
          name: 'a',
          tools: ['one'],
          activate: () => ({ tools: changer }),
          deactivate: () => {
            counted('a')();
            closing = host.deactivate();
          },
        }),
        fakeExtension({ name: 'b', deactivate: counted('b') }),
        fakeExtension({
          name: 'late',
          deactivate: counted('late'),
          activate: () => {
            changer.push(fakeTool('undeclared'));

            return {};
          },
        }),
      ],
    });
    const result = await host.activate({ signal });

    await closing;

    expect(result.active).toEqual([]);
    expect(counts).toEqual({ a: 1, b: 1, late: 1 });
  });
});
