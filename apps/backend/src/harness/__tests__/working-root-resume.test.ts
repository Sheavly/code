import { rm } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runTool } from '@sheavly/core/tool/tool.helper';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import { FileConversationStore } from '@sheavly/storage/conversation-store/conversation-store.service';
import { routedProvider, say } from '@sheavly/testing/provider/routed-provider.fake';
import { fakeBeforeTurn } from '@sheavly/workspace/testing/before-turn.fake';
import { useTempRepo } from '@sheavly/workspace/testing/git-repo.fake';
import { TrustStore } from '@sheavly/workspace/trust/trust.service';
import { memoryTrust } from '@sheavly/workspace/testing/trust.fake';
import { askingPermissions } from '../../testing/permissions.fake.js';
import { createBackendHarness } from '../harness.helper.js';
import { reportedWorkingRoot } from '../working-root-report.helper.js';

const repo = useTempRepo({ prefix: 'working-root-resume-', perTest: true });
const ID = conversationIdSchema.parse('00000000-0000-4000-8000-000000000001');

/** A harness for conversation `ID` over its `shell.json` in `store`, as a reopen builds one. */
function open(store: FileConversationStore) {
  return createBackendHarness({
    provider: routedProvider({ hi: [say('hello')] }),
    title: 'hi',
    workspaceRoot: repo.main,
    trustStore: new TrustStore({
      persistence: memoryTrust({ file: path.join(repo.base, 'trusted.json') }),
    }),
    env: process.env,
    permissions: askingPermissions(),
    shell: store.shell(ID),
  });
}

/** What the working root hook tells the agent at the start of a turn. */
async function turnNotes(harness: Awaited<ReturnType<typeof open>>): Promise<string[]> {
  const { messages, context } = fakeBeforeTurn();

  await harness.hooks.find((hook) => hook.name === 'working-root')?.beforeTurn?.(context);

  return messages.map((message) => message.content);
}

describe('the working root of a resumed conversation', () => {
  it('is already set when the conversation is reopened, with no new call to set_working_root', async () => {
    const store = new FileConversationStore({
      folder: path.join(repo.base, 'store'),
      onProblem: () => undefined,
    });
    const first = await open(store);
    const set = first.tools.find((tool) => tool.name === 'set_working_root');

    if (!set) throw new Error('set_working_root is not in the run');
    await runTool({
      tools: [set],
      call: {
        id: callIdSchema.parse('1'),
        name: 'set_working_root',
        input: { description: 'work in the worktree', path: repo.worktree },
      },
      signal: new AbortController().signal,
    });

    // A restart: a new store and a new harness over the same folder, as `reopen` builds them.
    const reopened = await open(
      new FileConversationStore({
        folder: path.join(repo.base, 'store'),
        onProblem: () => undefined,
      }),
    );

    await expect(turnNotes(reopened)).resolves.toEqual([
      expect.stringContaining(`Working root: ${repo.worktree} (branch feature)`),
    ]);
  });

  it('is reported with its branch while it can be used, and not once it is gone', async () => {
    const store = new FileConversationStore({
      folder: path.join(repo.base, 'store'),
      onProblem: () => undefined,
    });
    const harness = await open(store);
    const { workingRoots } = harness;

    await expect(reportedWorkingRoot({ workingRoots })).resolves.toBeUndefined();

    await workingRoots.set(repo.worktree);
    await expect(reportedWorkingRoot({ workingRoots })).resolves.toEqual({
      root: repo.worktree,
      branch: 'feature',
    });

    await rm(repo.worktree, { recursive: true });
    await expect(reportedWorkingRoot({ workingRoots })).resolves.toBeUndefined();
  });

  it('leaves the header detail out, and says why, when it cannot be read', async () => {
    const heard: unknown[] = [];
    const failing = {
      state: () => Promise.reject(new Error('git timed out')),
    } as unknown as Parameters<typeof reportedWorkingRoot>[0]['workingRoots'];

    await expect(
      reportedWorkingRoot({ workingRoots: failing, onFailure: (caught) => heard.push(caught) }),
    ).resolves.toBeUndefined();
    expect(heard).toEqual([expect.objectContaining({ message: 'git timed out' })]);
  });

  it('is not set in a conversation that never chose one', async () => {
    const store = new FileConversationStore({
      folder: path.join(repo.base, 'store'),
      onProblem: () => undefined,
    });

    await expect(turnNotes(await open(store))).resolves.toEqual([]);
  });
});
