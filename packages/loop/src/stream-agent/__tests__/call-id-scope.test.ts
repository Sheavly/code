import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Provider } from '@sheavly/core/provider/provider.types';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { startHeldTask } from '@sheavly/runtime/testing/held-task.fake';
import { startParentAndChild } from '@sheavly/runtime/testing/sessions.fake';
import { streamAgent } from '../stream-agent.helper.js';

const tasks = new TaskRegistry();
const sharedId = callIdSchema.parse('call_0');

afterEach(async () => {
  await tasks.cancelAll();
});

const echo = defineTool({
  name: 'echo',
  description: 'Answers at once; starts nothing',
  inputSchema: z.object({}),
  execute: async () => 'echoed',
});

describe('tool call ids on a registry shared by sessions', () => {
  it('does not take another session task for the one a plain tool call started', async () => {
    const sessions = new SessionRegistry();
    const { parent, child } = startParentAndChild(sessions);

    // The parent's task carries the id a provider also gave the child's plain tool call.
    startHeldTask({ tasks, sessionId: parent.id, callId: sharedId });

    let turn = 0;
    const provider: Provider = {
      async *stream() {
        if (turn++ === 0) {
          yield {
            type: 'tool_call',
            call: { id: sharedId, name: 'echo', input: { description: 'echo' } },
          };
          yield { type: 'done', stopReason: 'tool_use' };

          return;
        }

        yield { type: 'text_delta', text: 'Done.' };
        yield { type: 'done', stopReason: 'end_turn' };
      },
    };
    const types: string[] = [];

    for await (const event of streamAgent({
      provider,
      tools: [echo],
      messages: [{ role: 'user', content: 'Go.' }],
      tasks,
      session: { registry: sessions, ref: child },
    })) {
      types.push(event.type);
    }

    expect(types).toContain('tool_result');
    expect(types).not.toContain('task_running');
  });
});
