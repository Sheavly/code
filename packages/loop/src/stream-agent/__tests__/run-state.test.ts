import { afterEach, describe, expect, it } from 'vitest';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { startTaskTool } from '@sheavly/runtime/testing/start-task.fake';
import { scriptedProvider } from '@sheavly/testing/provider/scripted-provider.fake';
import { until } from '@sheavly/testing/wait/until.fake';
import { createTaskTools } from '@sheavly/tools/tasks/tasks.tool';
import { streamAgent } from '../stream-agent.helper.js';

let tasks: TaskRegistry;

afterEach(async () => {
  await tasks.cancelAll();
});

const startBackground = (id: string, ms: number): StreamEvent => ({
  type: 'tool_call',
  call: {
    id: callIdSchema.parse(id),
    name: 'start_task',
    input: { description: id, ms, output: 'done', backgroundKind: 'task' },
  },
});
const toolTurn = (...calls: StreamEvent[]): StreamEvent[] => [
  ...calls,
  { type: 'done', stopReason: 'tool_use' },
];
const say = (text: string): StreamEvent[] => [
  { type: 'text_delta', text },
  { type: 'done', stopReason: 'end_turn' },
];

/** Starts a run and returns its `run_state` events so far, and the signal that yields it. */
function start(turns: StreamEvent[][]) {
  const registry = new SessionRegistry();
  const ref = registry.startMain({ title: 'Chat' });
  const yielding = new AbortController();
  const states: { state: string; groupedTasks: number }[] = [];
  const finished = (async () => {
    const stream = streamAgent({
      provider: scriptedProvider(turns),
      tools: [startTaskTool(tasks), ...createTaskTools(tasks)],
      messages: [{ role: 'user', content: 'go' }],
      tasks,
      session: { registry, ref },
      keepSession: true,
      yieldSignal: yielding.signal,
    });

    for await (const event of stream) {
      if (event.type === 'run_state') {
        states.push({ state: event.state, groupedTasks: event.groupedTasks });
      }
    }
  })();

  return { states, finished, yielding, group: (...ids: string[]) => groupTasks(ids) };
}

function groupTasks(callIds: string[]) {
  const ids = callIds.flatMap((callId) => {
    const task = tasks.byCallId({ callId: callIdSchema.parse(callId) });

    return task ? [task.id] : [];
  });

  tasks.group({ ids, reason: 'Wait for them' });
}

describe('run_state while the run is held for tasks', () => {
  it('says ready (waiting on none) while only an ungrouped task runs', async () => {
    tasks = new TaskRegistry();
    const run = start([toolTurn(startBackground('a', 60_000)), say('Started.')]);

    await until(() => run.states.length > 0);
    expect(run.states).toEqual([{ state: 'waiting', groupedTasks: 0 }]);

    run.yielding.abort();
    await run.finished;
  });

  it('counts grouped tasks down as they end, then works again when they are delivered', async () => {
    tasks = new TaskRegistry();
    const run = start([
      toolTurn(startBackground('a', 60_000), startBackground('b', 60_000)),
      say('Grouped.'),
      say('Saw both.'),
    ]);

    await until(() => run.states.length > 0);
    run.group('a', 'b');
    await tasks.cancel(tasks.byCallId({ callId: callIdSchema.parse('a') })!.id);
    await until(() => run.states.some((s) => s.groupedTasks === 1));
    await tasks.cancel(tasks.byCallId({ callId: callIdSchema.parse('b') })!.id);
    await run.finished;

    expect(run.states.map((s) => `${s.state}:${s.groupedTasks}`)).toEqual([
      'waiting:0',
      'waiting:1',
      'working:0',
    ]);
  });

  it('says nothing when no task is held', async () => {
    tasks = new TaskRegistry();
    const run = start([say('Hello.')]);

    await run.finished;

    expect(run.states).toEqual([]);
  });
});
