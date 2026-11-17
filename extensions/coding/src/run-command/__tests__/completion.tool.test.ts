import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Provider } from '@sheavly/core/provider/provider.types';
import type { ProcessResult } from '@sheavly/process/process/process.types';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import type { Message } from '@sheavly/protocol/message/message.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { taskIdSchema } from '@sheavly/protocol/task/task.validator';
import { streamAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { useTempWorkspace } from '@sheavly/workspace/testing/temp-workspace.fake';
import { testProcesses } from '@sheavly/process/testing/process-runner.fake';
import { until } from '@sheavly/testing/wait/until.fake';
import { createRunCommandTool } from '../run-command.tool.js';
import { createStartServiceTool } from '../start-service.tool.js';
import { testPermissions } from '../../testing/permissions.fake.js';

const temp = useTempWorkspace({ prefix: 'command-completion-' });
let tasks: TaskRegistry;

afterEach(async () => {
  await tasks.cancelAll();
  vi.restoreAllMocks();
});

function setup(toolName: 'run_command' | 'start_service' = 'run_command') {
  tasks = new TaskRegistry();
  const finish = Promise.withResolvers<ProcessResult>();
  const processes = testProcesses();

  vi.spyOn(processes, 'runScript').mockImplementation(({ signal, onOutput }) => {
    signal.addEventListener('abort', () => {
      finish.resolve({ exitCode: null, output: '', timedOut: false });
    });

    return finish.promise.then((result) => {
      onOutput?.(result.output);

      return result;
    });
  });
  const requests: (readonly Message[])[] = [];
  const provider: Provider = {
    async *stream({ messages }) {
      requests.push([...messages]);

      if (requests.length === 1) {
        yield {
          type: 'tool_call',
          call: {
            id: callIdSchema.parse('start'),
            name: toolName,
            input: { description: 'Run CI', command: 'echo result', background: true },
          },
        };
        yield { type: 'done', stopReason: 'tool_use' };

        return;
      }

      yield { type: 'text_delta', text: 'Waiting for CI.' };
      yield { type: 'done', stopReason: 'end_turn' };
    },
  };
  const options = {
    workspace: temp.workspace,
    permissions: testPermissions({ mode: 'allow_all' }),
    processes,
    tasks,
  };
  const tools = [createRunCommandTool(options), createStartServiceTool(options)];
  const events: AgentEvent[] = [];
  const controller = new AbortController();
  const running = (async () => {
    for await (const event of streamAgent({
      provider,
      tools,
      tasks,
      messages: [{ role: 'user', content: 'Wait for CI.' }],
      signal: controller.signal,
    })) {
      events.push(event);
    }
  })();

  return { finish, requests, events, running, controller };
}

describe('command completion through the loop', () => {
  it('waits for finite work without global waiting', async () => {
    const { finish, requests, events, running } = setup();

    await until(() => events.some((event) => event.type === 'turn_end' && event.turn === 2));
    expect(tasks.hasPendingTasks()).toBe(true);
    expect(events.some((event) => event.type === 'done')).toBe(false);
    expect(requests).toHaveLength(2);
    finish.resolve({ exitCode: 0, output: 'CI passed', timedOut: false });
    await running;

    expect(requests).toHaveLength(3);
    expect(requests[2]?.at(-1)?.content).toContain('<harness-notice kind="task-finished">');
    expect(requests[2]?.at(-1)?.content).toContain('CI passed');
    expect(events.filter((event) => event.type === 'task_completed')).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'completed' });
    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index));
    expect(tasks.hasPendingTasks()).toBe(false);
  });

  it('leaves a persistent service running without holding the prompt open', async () => {
    const { events, running } = setup('start_service');

    await running;
    expect(tasks.hasPendingTasks()).toBe(false);
    expect(tasks.runningCount).toBe(1);
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'completed' });
    const started = events.find((event) => event.type === 'task_running');

    expect(started?.type === 'task_running' && started.message.content).toContain(
      'does not keep this prompt alive',
    );
  });

  it('delivers a failed finite command before ending the prompt', async () => {
    const { finish, requests, events, running } = setup();

    await until(() => requests.length === 2);
    finish.resolve({ exitCode: 3, output: 'CI failed', timedOut: false });
    await running;
    expect(requests[2]?.at(-1)?.content).toContain('failed · exit code 3');
    expect(events.filter((event) => event.type === 'task_completed')).toHaveLength(1);
  });

  it('cancelling finite work releases the prompt without a completion notification', async () => {
    const { requests, events, running } = setup();

    await until(() => requests.length === 2);
    await tasks.cancel(taskIdSchema.parse('t1'));
    await running;
    expect(events.some((event) => event.type === 'task_completed')).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'completed' });
  });

  it('an interrupt cancels background work before ending the run', async () => {
    const { controller, requests, events, running } = setup();

    await until(() => requests.length === 2);
    controller.abort();
    await running;
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'interrupted' });
    expect(tasks.runningCount).toBe(0);
    expect(tasks.get(taskIdSchema.parse('t1'))?.status).toBe('cancelled');
  });
});
