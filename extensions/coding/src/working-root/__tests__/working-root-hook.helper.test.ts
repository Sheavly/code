import { rm } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createInstructionHook } from '@sheavly/core/instruction-context/instruction-source.helper';
import { git, openWithWorktrees, useTempRepo } from '@sheavly/workspace/testing/git-repo.fake';
import { testWorkingRoots } from '@sheavly/workspace/testing/working-root-store.fake';
import { fakeBeforeTurn } from '../../testing/before-turn.fake.js';
import { workingRootSource } from '../working-root-hook.helper.js';

const repo = useTempRepo({ prefix: 'working-root-hook-', perTest: true });

/** The hook over a fresh conversation's root, and a turn whose history `addContext` fills. */
async function setup() {
  const workingRoots = testWorkingRoots({ workspace: await openWithWorktrees(repo.main) });
  const { messages, context } = fakeBeforeTurn();
  const { hook } = createInstructionHook(workingRootSource({ workingRoots }));
  const turn = () => hook.beforeTurn?.(context);

  return { workingRoots, messages, turn };
}

describe('working root hook', () => {
  it('adds nothing while no root was ever set', async () => {
    const { messages, turn } = await setup();

    await turn();

    expect(messages).toEqual([]);
  });

  it('tells the agent its root and branch, once, until it changes', async () => {
    const { workingRoots, messages, turn } = await setup();

    await workingRoots.set(repo.worktree);
    await turn();
    await turn();

    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toContain(`Working root: ${repo.worktree} (branch feature)`);
  });

  it('replaces the note when the root is cleared', async () => {
    const { workingRoots, messages, turn } = await setup();

    await workingRoots.set(repo.worktree);
    await turn();
    await workingRoots.clear();
    await turn();

    expect(messages).toHaveLength(2);
    expect(messages[1]?.content).toContain('No instructions currently apply.');
  });

  it('tells the agent when its root is gone, instead of failing the turn', async () => {
    const { workingRoots, messages, turn } = await setup();

    await workingRoots.set(repo.worktree);
    await turn();
    await rm(repo.worktree, { recursive: true });
    await turn();

    expect(messages).toHaveLength(2);
    expect(messages[1]?.content).toContain(`Working root: ${repo.worktree} can no longer be used`);
    expect(messages[1]?.content).toContain('set_working_root');
  });

  it('shows a long or multi-line branch name as one short line of data', async () => {
    const { workingRoots, messages, turn } = await setup();
    const long = `feature-${'x'.repeat(200)}`;

    await git(repo.worktree, 'switch', '-c', long);
    await workingRoots.set(repo.worktree);
    await turn();

    const note = messages[0]?.content ?? '';

    expect(note).toContain(`branch feature-${'x'.repeat(72)}…`);
    expect(note).not.toContain('x'.repeat(100));
  });
});
