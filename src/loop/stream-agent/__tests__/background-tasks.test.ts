import { afterEach, describe, expect, it } from 'vitest';
import { TaskRegistry } from '../../../runtime/tasks/tasks.service.js';
import { startTaskTool } from '../../../testing/start-task.fake.js';
import { createTaskTools } from '../../../tools/tasks/tasks.tool.js';
import type { Message, StreamEvent } from '@sheavly/core/message/message.types';
import type { Provider } from '@sheavly/core/provider/provider.types';
import { streamAgent } from '../stream-agent.helper.js';
import type { AgentEvent } from '../../events/events.types.js';
import type { AgentOptions } from '../stream-agent.types.js';

let tasks: TaskRegistry;

afterEach(async () => {
  await tasks.cancelAll();
});

const background = (id: string, ms: number, output = ''): StreamEvent => ({
  type: 'tool_call',
  call: { id, name: 'start_task', input: { description: `bg ${id}`, ms, output } },
});
const say = (text: string): StreamEvent[] => [
  { type: 'text_delta', text },
  { type: 'done', stopReason: 'end_turn' },
];

/** Plays back scripted turns and records what the model was sent each time. */
function recordingProvider(turns: StreamEvent[][]) {
  const requests: Message[][] = [];
  const provider: Provider = {
    async *stream({ messages }) {
      requests.push(messages);
      const events = turns[requests.length - 1];

      if (!events) throw new Error('ran out of scripted turns');
      yield* events;
    },
  };

  return { provider, requests };
}

function options(provider: Provider, extra: Partial<AgentOptions> = {}): AgentOptions {
  return {
    provider,
    tools: [startTaskTool(tasks), ...createTaskTools(tasks)],
    messages: [{ role: 'user', content: 'go' }],
    tasks,
    ...extra,
  };
}

async function collect(stream: AsyncIterable<AgentEvent>) {
  const events: AgentEvent[] = [];

  for await (const event of stream) events.push(event);

  return events;
}

const types = (events: AgentEvent[]) => events.map((e) => e.type);
const lastUserMessage = (messages: Message[] | undefined) =>
  messages?.filter((m) => m.role === 'user').at(-1);

describe('background tasks in the loop', () => {
  it("a background command doesn't block the turn: it yields task_running and the run ends", async () => {
    tasks = new TaskRegistry();
    const { provider } = recordingProvider([
      [background('c1', 2_000), { type: 'done', stopReason: 'tool_use' }],
      say('Started it.'),
    ]);

    const started = performance.now();
    const events = await collect(streamAgent(options(provider)));

    expect(performance.now() - started).toBeLessThan(1_000);
    expect(types(events)).toEqual([
      'tool_call_started',
      'turn_end',
      'tool_batch',
      'task_running', // in place of tool_result
      'text_delta',
      'turn_end',
      'done',
    ]);
    const running = events[3];

    expect(running?.type === 'task_running' && running.task).toMatchObject({
      id: 't1',
      callId: 'c1',
      status: 'running',
    });
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'completed' });
    expect(tasks.get('t1')?.status).toBe('running'); // outlives the run
  });

  it('the completion arrives later through the same ordered queue, and the model is told', async () => {
    tasks = new TaskRegistry();
    const { provider, requests } = recordingProvider([
      [background('c1', 300, 'built'), { type: 'done', stopReason: 'tool_use' }],
      say('Waiting for the build.'),
      say('The build finished.'),
    ]);

    const events = await collect(streamAgent(options(provider, { waitForTasks: true })));

    expect(types(events)).toEqual([
      'tool_call_started',
      'turn_end',
      'tool_batch',
      'task_running',
      'text_delta', // the model kept going while the task ran
      'turn_end',
      'task_completed', // released at the turn boundary, before the next model call
      'text_delta',
      'turn_end',
      'done',
    ]);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));

    const completed = events[6];

    expect(completed?.type === 'task_completed' && completed.task).toMatchObject({
      id: 't1',
      status: 'completed',
      exitCode: 0,
    });
    expect(lastUserMessage(requests[2])?.content).toMatch(
      /Background task finished:\n\[task t1 · completed · exit code 0/,
    );
    expect(lastUserMessage(requests[2])?.content).toContain('built');
  });

  it('a completion that happens after the run is delivered at the start of the next run', async () => {
    tasks = new TaskRegistry();
    const first = recordingProvider([
      [background('c1', 0, 'quick'), { type: 'done', stopReason: 'tool_use' }],
      say('Ok.'),
    ]);
    const firstEvents = await collect(streamAgent(options(first.provider)));
    const done = firstEvents.at(-1);

    while (tasks.runningCount > 0) await new Promise((resolve) => setTimeout(resolve, 10));

    const second = recordingProvider([say('I saw it finish.')]);
    const history = done?.type === 'done' ? done.messages : [];
    const events = await collect(
      streamAgent(
        options(second.provider, { messages: [...history, { role: 'user', content: 'status?' }] }),
      ),
    );

    expect(types(events)).toEqual(['task_completed', 'text_delta', 'turn_end', 'done']);
    expect(lastUserMessage(second.requests[0])?.content).toContain('[task t1 · completed');
  });

  it('multiple tasks run concurrently, and their completions serialize through the queue', async () => {
    tasks = new TaskRegistry();
    const { provider } = recordingProvider([
      [
        background('a', 200, 'A'),
        background('b', 800, 'B'),
        { type: 'done', stopReason: 'tool_use' },
      ],
      say('Both started.'),
      say('A done.'),
      say('B done.'),
    ]);

    const started = performance.now();
    const events = await collect(streamAgent(options(provider, { waitForTasks: true })));

    expect(performance.now() - started).toBeLessThan(1_500); // 0.8s overall, not 1.0s+ serially plus turns
    const completions = events.flatMap((e) =>
      e.type === 'task_completed' ? [e.task.output.trim()] : [],
    );

    expect(completions).toEqual(['A', 'B']);
    // Each completion lands in its own turn, between turn boundaries.
    expect(types(events).filter((t) => t === 'turn_end' || t === 'task_completed')).toEqual([
      'turn_end',
      'turn_end',
      'task_completed',
      'turn_end',
      'task_completed',
      'turn_end',
    ]);
  });

  it('the agent can cancel a task; nothing is left to wait for, so the run ends', async () => {
    tasks = new TaskRegistry();
    const { provider } = recordingProvider([
      [background('c1', 5_000), { type: 'done', stopReason: 'tool_use' }],
      [
        {
          type: 'tool_call',
          call: { id: 'c2', name: 'cancel_task', input: { description: 'stop it', id: 't1' } },
        },
        { type: 'done', stopReason: 'tool_use' },
      ],
      say('Stopped.'),
    ]);

    const started = performance.now();
    const events = await collect(streamAgent(options(provider, { waitForTasks: true })));

    expect(performance.now() - started).toBeLessThan(2_000);
    expect(tasks.get('t1')?.status).toBe('cancelled');
    expect(types(events)).not.toContain('task_completed');
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'completed' });
  });

  it('an interrupt stops waiting for tasks; the tasks themselves keep running', async () => {
    tasks = new TaskRegistry();
    const controller = new AbortController();
    const { provider } = recordingProvider([
      [background('c1', 5_000), { type: 'done', stopReason: 'tool_use' }],
      say('Waiting.'),
    ]);

    setTimeout(() => controller.abort(), 200);
    const events = await collect(
      streamAgent(options(provider, { waitForTasks: true, signal: controller.signal })),
    );

    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'interrupted' });
    expect(tasks.get('t1')?.status).toBe('running'); // the caller decides (the demo cancels on exit)
  });
});
