import { describe, expect, it } from 'vitest';
import { runSession } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { createSubAgentTool } from '@sheavly/tools/sub-agent/sub-agent.tool';
import {
  calls,
  routedProvider,
  say,
  toolCall,
} from '@sheavly/testing/provider/routed-provider.fake';
import type { TaskInfo } from '@sheavly/protocol/task/task.types';

const start = (id: string, title: string, task: string) =>
  toolCall({ id, name: 'start_agent', input: { title, task } });

/** A main session whose sub-agents all share the run's one registry, observed like the host does. */
function sharedRun(scripts: Parameters<typeof routedProvider>[0]) {
  const sessions = new SessionRegistry();
  const tasks = new TaskRegistry();
  const started: TaskInfo[] = [];

  tasks.observe(({ update }) => {
    if (update.type === 'task_started') started.push(update.task);
  });

  const provider = routedProvider(scripts);
  const main = sessions.startMain({ title: 'Main' });
  const tool = createSubAgentTool({
    sessions,
    tasks,
    provider,
    runAgent: runSession,
    tools: [],
  });
  const run = (content: string) =>
    runSession({
      provider,
      tools: [tool],
      messages: [{ role: 'user', content }],
      tasks,
      session: { registry: sessions, ref: main },
    });

  return { started, run };
}

const together = {
  Go: [calls(start('a', 'One', 'First'), start('b', 'Two', 'Second')), say('Done.')],
  First: [say('one')],
  Second: [say('two')],
};
const nested = {
  Go: [calls(start('a', 'Outer', 'Outer task')), say('Done.')],
  'Outer task': [calls(start('b', 'Inner', 'Inner task')), say('Outer done.')],
  'Inner task': [say('inner')],
};

describe('sub-agents on one task registry', () => {
  it.each([
    ['two sub-agents started together', together],
    ['a sub-agent nested under a sub-agent', nested],
  ])('gives %s task ids that never collide', async (_name, scripts) => {
    const { started, run } = sharedRun(scripts);

    const { reason } = await run('Go');

    expect(reason).toBe('completed');
    expect(started.map((task) => task.id)).toEqual(['t1', 't2']);
    expect(started.map((task) => task.callId)).toEqual(['a', 'b']);
  });
});
