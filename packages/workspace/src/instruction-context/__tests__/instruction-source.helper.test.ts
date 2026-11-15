import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Message } from '@sheavly/protocol/message/message.types';
import { agentsMdSource } from '../../agents-md/agents-md.helper.js';
import { InstructionSourceError } from '../../errors/instruction-source.errors.js';
import { fakeBeforeTurn } from '../../testing/before-turn.fake.js';
import { openWithWorktrees, useTempRepo } from '../../testing/git-repo.fake.js';
import { testWorkingRoots } from '../../testing/working-root-store.fake.js';
import { createInstructionHook, registerInstructionHooks } from '../instruction-source.helper.js';
import type { InstructionSource } from '../instruction-source.types.js';

const repo = useTempRepo({ prefix: 'instruction-source-', perTest: true });

function source(name: string, order: number, text = name): InstructionSource {
  return { name, order, resolve: () => text };
}

/** Runs one turn of a hook over `messages`, as the loop does with the history it holds. */
async function turnOver(params: { source: InstructionSource; messages: Message[] }) {
  const { messages } = params;
  const { context } = fakeBeforeTurn();

  await createInstructionHook(params.source).hook.beforeTurn?.({
    ...context,
    messages,
    addContext: (content: string) => messages.push({ role: 'user', content }),
  });
}

describe('createInstructionHook with a worktree working root', () => {
  it('reads AGENTS.md from the worktree, not the main checkout', async () => {
    await writeFile(path.join(repo.main, 'AGENTS.md'), 'Main rules');
    await writeFile(path.join(repo.worktree, 'AGENTS.md'), 'Worktree rules');

    const workingRoots = testWorkingRoots({ workspace: await openWithWorktrees(repo.main) });
    const messages: Message[] = [];
    const agents = agentsMdSource({ root: repo.main, workingRoots });

    await turnOver({ source: agents, messages });
    await workingRoots.set(repo.worktree);
    await turnOver({ source: agents, messages });

    expect(messages).toHaveLength(2);
    expect(messages[0]?.content).toContain('Main rules');
    expect(messages[1]?.content).toContain('Worktree rules');
    expect(messages[1]?.content).not.toContain('Main rules');
  });

  it('narrows to a folder inside the project root', async () => {
    await writeFile(path.join(repo.main, 'AGENTS.md'), 'Main rules');
    await writeFile(path.join(repo.main, 'src', 'AGENTS.md'), 'Src rules');

    const workingRoots = testWorkingRoots({ workspace: await openWithWorktrees(repo.main) });
    const messages: Message[] = [];

    await workingRoots.set(path.join(repo.main, 'src'));
    await turnOver({ source: agentsMdSource({ root: repo.main, workingRoots }), messages });

    expect(messages[0]?.content).toContain('Main rules');
    expect(messages[0]?.content).toContain('Src rules');
  });
});

describe('instruction dedup', () => {
  it('announces once while the entry stays in history, even when other history is masked', async () => {
    const messages: Message[] = [];
    const rules = source('rules', 1, 'v1');

    await turnOver({ source: rules, messages });
    messages.push({ role: 'user', content: 'a masked tool output' });
    await turnOver({ source: rules, messages });

    expect(messages.filter((m) => m.content.startsWith('<instruction-context'))).toHaveLength(1);
  });

  it('announces again once a summary or masking dropped the entry from history', async () => {
    const messages: Message[] = [];
    const rules = source('rules', 1, 'v1');

    await turnOver({ source: rules, messages });
    messages.splice(0, messages.length, { role: 'user', content: 'summary of the run' });
    await turnOver({ source: rules, messages });

    expect(messages.map((m) => m.content)).toEqual([
      'summary of the run',
      '<instruction-context name="rules">\nv1\n</instruction-context>',
    ]);
  });
});

describe('registerInstructionHooks', () => {
  it('orders hooks by their declared order, not by registration position', () => {
    const hooks = registerInstructionHooks([
      createInstructionHook(source('third', 30)),
      createInstructionHook(source('first', 10)),
      createInstructionHook(source('second', 20)),
    ]);

    expect(hooks.map((hook) => hook.name)).toEqual(['first', 'second', 'third']);
  });

  it('keeps registration order for equal orders', () => {
    const hooks = registerInstructionHooks([
      createInstructionHook(source('a', 1)),
      createInstructionHook(source('b', 1)),
    ]);

    expect(hooks.map((hook) => hook.name)).toEqual(['a', 'b']);
  });

  it('fails on two sources with one name', () => {
    expect(() =>
      registerInstructionHooks([
        createInstructionHook(source('same', 1)),
        createInstructionHook(source('same', 2)),
      ]),
    ).toThrow(InstructionSourceError);
  });
});
