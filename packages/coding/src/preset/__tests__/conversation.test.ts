import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import { createConversation } from '@sheavly/host/conversation/conversation.helper';
import { streamAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { collect } from '@sheavly/testing/fetch/fake-fetch.fake';
import { scriptedProvider } from '@sheavly/testing/provider/scripted-provider.fake';
import { toolCall } from '@sheavly/testing/provider/routed-provider.fake';
import { until } from '@sheavly/testing/wait/until.fake';
import { createTaskTools } from '@sheavly/tools/tasks/tasks.tool';
import { createRunCommandTool } from '../../run-command/run-command.tool.js';
import { createCodingHarness } from '../coding.helper.js';

const say = (text: string): StreamEvent[] => [
  { type: 'text_delta', text },
  { type: 'done', stopReason: 'end_turn' },
];
const runCommand = (id: string, input: Record<string, unknown>): StreamEvent[] => [
  toolCall({ id, name: 'run_command', input }),
  { type: 'done', stopReason: 'tool_use' },
];

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'coding-conversation-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A coding conversation whose model plays `responses`, with run_command and the task tools. */
async function setup(responses: StreamEvent[][]) {
  const harness = await createCodingHarness({
    provider: scriptedProvider(responses),
    title: 'Chat',
    workspaceRoot: root,
    env: { PATH: process.env.PATH },
  });
  const { workspace, tasks, processes } = harness;
  const conversation = createConversation({
    harness,
    run: streamAgent,
    tools: [
      createRunCommandTool({ workspace, skipAllowList: true, tasks, processes }),
      ...createTaskTools(tasks),
    ],
  });

  return { harness, conversation };
}

describe('a coding conversation', () => {
  it('keeps a background command running between prompts, and close() kills it', async () => {
    const { harness, conversation } = await setup([
      runCommand('c1', { command: 'sleep 30', background: true }),
      say('started'),
      say('still there'),
    ]);

    await collect(conversation.send('start a server'));
    await collect(conversation.send('is it up?'));
    expect(harness.processes.running).toBe(1);

    await conversation.close();

    expect(harness.processes.running).toBe(0);
    expect(harness.tasks.runningCount).toBe(0);
    expect(harness.sessions.get(harness.mainSession.id)?.state).toBe('completed');
  });

  it('close() stops a command the running prompt is waiting on', async () => {
    const { harness, conversation } = await setup([runCommand('c1', { command: 'sleep 30' })]);
    const running = collect(conversation.send('run it'));

    await until(() => harness.processes.running === 1);
    await conversation.close();
    await running;
    // Killed, not left to run its 30s: the group's exit arrives moments after the signal.
    await until(() => harness.processes.running === 0, 2000);

    expect(conversation.messages.at(-1)).toMatchObject({ role: 'tool', isError: true });
  });
});
