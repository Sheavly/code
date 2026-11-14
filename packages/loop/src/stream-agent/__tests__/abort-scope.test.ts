import { afterEach, describe, expect, it } from 'vitest';
import type { Provider } from '@sheavly/core/provider/provider.types';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { startHeldTask } from '@sheavly/runtime/testing/held-task.fake';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import type { SessionId } from '@sheavly/protocol/session/session.types';
import { until } from '@sheavly/testing/wait/until.fake';
import { streamAgent } from '../stream-agent.helper.js';

const tasks = new TaskRegistry();

/** Reads the run to its end. */
async function collectEvents(stream: AsyncIterable<unknown>) {
  const events: unknown[] = [];

  for await (const event of stream) events.push(event);

  return events;
}

afterEach(async () => {
  await tasks.cancelAll();
});

const held = (sessionId: SessionId) => startHeldTask({ tasks, sessionId });

describe('stopping a session on a registry its run shares', () => {
  it('cancels the tasks that session owns and leaves its parent and sibling running', async () => {
    const sessions = new SessionRegistry();
    const parent = sessions.startMain({ title: 'Parent' });
    const child = sessions.startChild({
      parentId: parent.id,
      startedByCall: callIdSchema.parse('c1'),
      title: 'Child',
    });
    const sibling = sessions.startChild({
      parentId: parent.id,
      startedByCall: callIdSchema.parse('c2'),
      title: 'Sibling',
    });
    const parents = held(parent.id);
    const siblings = held(sibling.id);
    const children = held(child.id);
    const controller = new AbortController();
    const provider: Provider = {
      async *stream() {
        yield { type: 'text_delta', text: 'Working.' };
        yield { type: 'done', stopReason: 'end_turn' };
      },
    };
    const run = collectEvents(
      streamAgent({
        provider,
        tools: [],
        messages: [{ role: 'user', content: 'Go.' }],
        tasks,
        signal: controller.signal,
        session: { registry: sessions, ref: child },
      }),
    );

    await until(() => tasks.settleWaiters === 1);
    controller.abort();
    await run;

    expect(tasks.get(children.id)?.status).toBe('cancelled');
    expect(tasks.get(parents.id)?.status).toBe('running');
    expect(tasks.get(siblings.id)?.status).toBe('running');
  });
});
