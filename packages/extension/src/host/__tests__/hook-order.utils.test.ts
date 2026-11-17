import { describe, expect, it } from 'vitest';
import { ContributionCollisionError, HookOrderError } from '../../errors/extension.errors.js';
import type { Contributions } from '../../extension/extension.types.js';
import { placeHook } from '../../extension/extension.utils.js';
import { fakeExtension, fakeHook } from '../../testing/extension.fake.js';
import { ExtensionHost } from '../extension-host.service.js';

const signal = new AbortController().signal;

/** The merged hook names for extensions that contribute these hooks, one extension each, in order. */
async function merged(...hooks: Contributions['hooks'][]): Promise<string[]> {
  const host = new ExtensionHost({
    extensions: hooks.map((contributed, index) =>
      fakeExtension({ name: `ext-${index}`, activate: () => ({ hooks: contributed }) }),
    ),
  });
  const { contributions } = await host.activate({ signal });

  return contributions.hooks.map((hook) => hook.name);
}

describe('hook order', () => {
  it('keeps activation order for hooks without constraints', async () => {
    expect(await merged([fakeHook('a'), fakeHook('b')], [fakeHook('c')])).toEqual(['a', 'b', 'c']);
  });

  it('puts a hook before one another extension contributed', async () => {
    const early = placeHook({ hook: fakeHook('early'), before: ['a'] });

    expect(await merged([fakeHook('a')], [early])).toEqual(['early', 'a']);
  });

  it('puts a hook after one that comes later in activation order', async () => {
    const late = placeHook({ hook: fakeHook('late'), after: ['c'] });

    expect(await merged([late, fakeHook('b')], [fakeHook('c')])).toEqual(['b', 'c', 'late']);
  });

  it('moves only the placed hook, to just before the one it names, not the hooks between them', async () => {
    const x = placeHook({ hook: fakeHook('x'), before: ['a'] });

    expect(await merged([fakeHook('a'), fakeHook('b')], [fakeHook('c'), x])).toEqual([
      'x',
      'a',
      'b',
      'c',
    ]);
  });

  it('moves only the placed hook, to just after the one it names', async () => {
    const x = placeHook({ hook: fakeHook('x'), after: ['b'] });

    expect(await merged([x, fakeHook('a')], [fakeHook('b'), fakeHook('c')])).toEqual([
      'a',
      'b',
      'x',
      'c',
    ]);
  });

  it('follows a chain of placements without reordering the rest', async () => {
    const y = placeHook({ hook: fakeHook('y'), before: ['x'] });
    const x = placeHook({ hook: fakeHook('x'), before: ['a'] });

    expect(await merged([fakeHook('a'), fakeHook('b')], [y, x])).toEqual(['y', 'x', 'a', 'b']);
  });

  it('puts a hook before the original position of a hook that is itself placed after another', async () => {
    const a = placeHook({ hook: fakeHook('a'), after: ['c'] });
    const x = placeHook({ hook: fakeHook('x'), before: ['a'] });

    expect(await merged([a, fakeHook('b'), fakeHook('c')], [x])).toEqual(['x', 'b', 'c', 'a']);
  });

  it('ignores a constraint naming a hook that is not in the run', async () => {
    const lonely = placeHook({ hook: fakeHook('lonely'), before: ['gone'], after: ['missing'] });

    expect(await merged([fakeHook('a')], [lonely])).toEqual(['a', 'lonely']);
  });

  it('throws a HookOrderError naming the hooks of a cycle', async () => {
    const a = placeHook({ hook: fakeHook('a'), after: ['b'] });
    const b = placeHook({ hook: fakeHook('b'), after: ['a'] });
    const caught = await merged([a], [b]).catch((caughtError: unknown) => caughtError);

    expect(caught).toBeInstanceOf(HookOrderError);
    expect((caught as HookOrderError).hooks).toEqual(['a', 'b']);
    expect((caught as Error).message).toContain('a, b');
  });

  it('throws a HookOrderError for a hook placed against itself', async () => {
    const self = placeHook({ hook: fakeHook('self'), before: ['self'] });

    await expect(merged([self])).rejects.toThrow(HookOrderError);
    await expect(merged([self])).rejects.toThrow(/"self"/);
  });

  it('still fails two hooks with one name as a collision', async () => {
    await expect(
      merged([fakeHook('same')], [placeHook({ hook: fakeHook('same') })]),
    ).rejects.toThrow(ContributionCollisionError);
  });
});
