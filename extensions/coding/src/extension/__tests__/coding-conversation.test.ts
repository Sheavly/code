import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import { createConversation } from '@sheavly/host/conversation/conversation.helper';
import { createHarness } from '@sheavly/host/host/host.helper';
import { errorCode } from '@sheavly/runtime/errors/errors.utils';
import { streamAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { collect } from '@sheavly/testing/fetch/fake-fetch.fake';
import { scriptedProvider } from '@sheavly/testing/provider/scripted-provider.fake';
import { toolCall } from '@sheavly/testing/provider/routed-provider.fake';
import { until } from '@sheavly/testing/wait/until.fake';
import { codingRun } from '../../testing/coding-run.fake.js';
import { testPermissions } from '../../testing/permissions.fake.js';

const say = (text: string): StreamEvent[] => [
  { type: 'text_delta', text },
  { type: 'done', stopReason: 'end_turn' },
];
const call = (params: { id: string; name: string; command: string }): StreamEvent[] => [
  toolCall({ id: params.id, name: params.name, input: { command: params.command } }),
  { type: 'done', stopReason: 'tool_use' },
];

/** Starts `sleep`, which writes the id of its process group to `pid` first. */
const SLEEP = "sh -c 'echo $$ > pid; exec sleep 30'";

let root: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'coding-conversation-')));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A coding conversation whose model plays `responses`, with the tools the extension contributes. */
async function setup(responses: StreamEvent[][]) {
  const harness = createHarness({ provider: scriptedProvider(responses), title: 'Chat' });
  const run = await codingRun({
    project: root,
    harness,
    env: { PATH: process.env.PATH },
    permissions: testPermissions({ mode: 'allow_all' }),
  }).activate();
  const conversation = createConversation({
    harness,
    run: streamAgent,
    tools: [...run.result.contributions.tools],
  });

  return { harness, conversation, run };
}

/** Whether the process group `pid` names is gone. */
function isGone(pid: number): boolean {
  try {
    process.kill(-pid, 0);

    return false;
  } catch (caughtError) {
    // ESRCH: no such group, which is what a stopped command leaves.
    if (errorCode(caughtError) === 'ESRCH') return true;

    throw caughtError;
  }
}

/** The process group id the started command wrote, once it has. */
async function startedPid(): Promise<number> {
  for (let attempt = 0; attempt < 300; attempt++) {
    try {
      const pid = Number((await readFile(path.join(root, 'pid'), 'utf8')).trim());

      if (pid > 0) return pid;
    } catch (caughtError) {
      // ENOENT: the command has not written it yet.
      if (errorCode(caughtError) !== 'ENOENT') throw caughtError;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error('the command never wrote its process group id');
}

describe('a coding conversation', () => {
  it('keeps a background service running between prompts, and close() kills it', async () => {
    const { harness, conversation, run } = await setup([
      call({ id: 'c1', name: 'start_service', command: SLEEP }),
      say('started'),
      say('still there'),
    ]);

    await collect(conversation.send('start a server'));
    await collect(conversation.send('is it up?'));

    const pid = await startedPid();

    expect(isGone(pid)).toBe(false);

    await conversation.close();
    await until(() => isGone(pid), 2000);

    expect(harness.tasks.runningCount).toBe(0);
    expect(harness.sessions.get(harness.mainSession.id)?.state).toBe('completed');

    await run.deactivate();
  });

  it('close() stops a command the running prompt is waiting on', async () => {
    const { conversation, run } = await setup([
      call({ id: 'c1', name: 'run_command', command: SLEEP }),
    ]);
    const running = collect(conversation.send('run it'));
    const pid = await startedPid();

    await conversation.close();
    await running;
    // Killed, not left to run its 30s: the group's exit arrives moments after the signal.
    await until(() => isGone(pid), 2000);

    expect(conversation.messages.at(-1)).toMatchObject({ role: 'tool', isError: true });

    await run.deactivate();
  });
});
