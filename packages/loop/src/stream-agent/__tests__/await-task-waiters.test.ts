import { describe, expect, it } from 'vitest';
import { scriptedProvider } from '@sheavly/testing/provider/scripted-provider.fake';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { startTaskTool } from '@sheavly/runtime/testing/start-task.fake';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { runSession } from '../stream-agent.helper.js';

const startBackground = (id: string, ms: number) => [
  {
    type: 'tool_call' as const,
    call: {
      id: callIdSchema.parse(id),
      name: 'start_task',
      input: { description: `bg ${id}`, ms, output: '', waitForCompletion: false },
    },
  },
  { type: 'done' as const, stopReason: 'tool_use' as const },
];
const say = (text: string) => [
  { type: 'text_delta' as const, text },
  { type: 'done' as const, stopReason: 'end_turn' as const },
];

describe('a run waiting for background tasks', () => {
  it('leaves no inbox or task waiter behind once the tasks have finished', async () => {
    const tasks = new TaskRegistry();
    const registry = new SessionRegistry();
    // Kept, so the session ending does not wake (and so clear) the inbox waiters by itself.
    const ref = registry.startMain({ title: 'Chat' });

    await runSession({
      provider: scriptedProvider([startBackground('c1', 20), say('Waiting.'), say('Done once.')]),
      tools: [startTaskTool(tasks)],
      messages: [{ role: 'user', content: 'go' }],
      tasks,
      waitForTasks: true,
      session: { registry, ref },
      keepSession: true,
    });

    expect(tasks.settleWaiters).toBe(0);
    expect(registry.inboxWaiters(ref.id)).toBe(0);
  });
});
