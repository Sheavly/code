import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createInstructionHook } from '@sheavly/core/instruction-context/instruction-source.helper';
import type { InstructionSource } from '@sheavly/core/instruction-context/instruction-source.types';
import type { Message } from '@sheavly/protocol/message/message.types';
import { fakeBeforeTurn } from '../../testing/before-turn.fake.js';
import { openWithWorktrees, useTempRepo } from '../../testing/git-repo.fake.js';
import { testWorkingRoots } from '../../testing/working-root-store.fake.js';
import { agentsMdSource } from '../agents-md.helper.js';

const repo = useTempRepo({ prefix: 'agents-md-working-root-', perTest: true });

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

describe('the AGENTS.md hook with a worktree working root', () => {
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
