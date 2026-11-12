import { afterEach, describe, expect, it } from 'vitest';
import { scriptedProvider } from '@sheavly/testing/provider/scripted-provider.fake';
import { until } from '@sheavly/testing/wait/until.fake';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { startTaskTool } from '@sheavly/runtime/testing/start-task.fake';
import { createTaskTools } from '@sheavly/tools/tasks/tasks.tool';
import { runSession } from '../stream-agent.helper.js';

let tasks: TaskRegistry;

afterEach(async () => {
  await tasks.cancelAll();
});

const startBackground = (ms: number): StreamEvent => ({
  type: 'tool_call',
  call: {
    id: callIdSchema.parse('c1'),
    name: 'start_task',
    input: { description: 'bg', ms, output: 'done', backgroundKind: 'task' },
  },
});
const say = (text: string): StreamEvent[] => [
  { type: 'text_delta', text },
  { type: 'done', stopReason: 'end_turn' },
];

function run(params: { turns: StreamEvent[][]; yieldSignal: AbortSignal }) {
  const registry = new SessionRegistry();
  const ref = registry.startMain({ title: 'Chat' });

  return runSession({
    provider: scriptedProvider(params.turns),
    tools: [startTaskTool(tasks), ...createTaskTools(tasks)],
    messages: [{ role: 'user', content: 'go' }],
    tasks,
    session: { registry, ref },
    keepSession: true,
    yieldSignal: params.yieldSignal,
  });
}

describe('yieldSignal', () => {
  it('ends the run at its completion point while a background task still runs', async () => {
    tasks = new TaskRegistry();
    const yielding = new AbortController();

    yielding.abort();

    const result = await run({
      turns: [[startBackground(60_000), { type: 'done', stopReason: 'tool_use' }], say('Started.')],
      yieldSignal: yielding.signal,
    });

    expect(result.reason).toBe('completed');
    expect(result.messages.at(-1)).toMatchObject({ content: 'Started.' });
  });

  it('stops waiting for background work when the yield arrives mid-wait', async () => {
    tasks = new TaskRegistry();
    const yielding = new AbortController();
    const finished = run({
      turns: [[startBackground(60_000), { type: 'done', stopReason: 'tool_use' }], say('Started.')],
      yieldSignal: yielding.signal,
    });
    let settled = false;

    void finished.then(() => {
      settled = true;
    });
    await until(() => tasks.settleWaiters > 0);
    expect(settled).toBe(false);

    yielding.abort();

    expect((await finished).reason).toBe('completed');
    expect(tasks.settleWaiters).toBe(0);
  });

  it('leaves a finished task result for the next run instead of losing it', async () => {
    tasks = new TaskRegistry();
    const registry = new SessionRegistry();
    const ref = registry.startMain({ title: 'Chat' });
    const yielding = new AbortController();
    const requests: string[][] = [];
    const provider = scriptedProvider([
      [startBackground(5), { type: 'done', stopReason: 'tool_use' }],
      say('Started.'),
      say('Saw it.'),
    ]);
    const recording: typeof provider = {
      stream: (request) => {
        requests.push(request.messages.map((message) => JSON.stringify(message)));

        return provider.stream(request);
      },
    };
    const options = {
      provider: recording,
      tools: [startTaskTool(tasks), ...createTaskTools(tasks)],
      tasks,
      session: { registry, ref },
      keepSession: true,
    };

    yielding.abort();
    const first = await runSession({
      ...options,
      messages: [{ role: 'user', content: 'go' }],
      yieldSignal: yielding.signal,
    });

    await until(() => tasks.hasDeliveries(ref.id));
    registry.resume(ref.id);
    await runSession({
      ...options,
      messages: [...first.messages, { role: 'user', content: 'next' }],
      resumed: true,
    });

    expect(requests).toHaveLength(3);
    expect(requests[2]?.join('\n')).toContain('bg');
    expect(tasks.hasDeliveries(ref.id)).toBe(false);
  });

  it('keeps waiting for background work without a yield', async () => {
    tasks = new TaskRegistry();
    const result = await run({
      turns: [
        [startBackground(5), { type: 'done', stopReason: 'tool_use' }],
        say('Started.'),
        say('Saw the result.'),
      ],
      yieldSignal: new AbortController().signal,
    });

    expect(result.messages.at(-1)).toMatchObject({ content: 'Saw the result.' });
  });
});
