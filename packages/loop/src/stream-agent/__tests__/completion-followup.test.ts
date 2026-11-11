import { expect, it, vi } from 'vitest';
import { scriptedProvider } from '@sheavly/testing/provider/scripted-provider.fake';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { runSession } from '../stream-agent.helper.js';

it('handles a follow-up that arrives as the final task check resolves instead of ending the run', async () => {
  const registry = new SessionRegistry();
  const ref = registry.startMain({ title: 'Chat' });
  const tasks = new TaskRegistry();

  vi.spyOn(tasks, 'hasPendingTasks').mockImplementationOnce(() => {
    queueMicrotask(() => {
      registry.send({ id: ref.id, from: 'user', content: 'Also check deployment safety.' });
    });

    return false;
  });

  const result = await runSession({
    provider: scriptedProvider([
      [{ type: 'done', stopReason: 'end_turn' }],
      [
        { type: 'text_delta', text: 'Handled the follow-up.' },
        { type: 'done', stopReason: 'end_turn' },
      ],
    ]),
    tools: [],
    messages: [{ role: 'user', content: 'Review the changes.' }],
    tasks,
    session: { registry, ref },
    keepSession: true,
  });

  expect(result.reason).toBe('completed');
  expect(
    result.messages.filter((message) => message.role === 'user').map((message) => message.content),
  ).toEqual(['Review the changes.', 'Also check deployment safety.']);
  expect(result.messages.at(-1)).toMatchObject({ content: 'Handled the follow-up.' });
  expect(registry.hasMessages(ref.id)).toBe(false);
});
