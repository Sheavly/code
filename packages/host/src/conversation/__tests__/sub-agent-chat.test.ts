import { describe, expect, it } from 'vitest';
import type { Provider, ProviderRequest } from '@sheavly/core/provider/provider.types';
import { runSession, streamAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { createSubAgentTool } from '@sheavly/tools/sub-agent/sub-agent.tool';
import {
  calls,
  routedProvider,
  say,
  toolCall,
} from '@sheavly/testing/provider/routed-provider.fake';
import { until } from '@sheavly/testing/wait/until.fake';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import { createHarness } from '../../host/host.helper.js';
import { createConversation } from '../conversation.helper.js';

/** A conversation whose one sub-agent works until `finish` resolves; `seen` is what the main session's model was sent. */
function conversationWithSlowSubAgent(options: { waitForTasks?: boolean } = {}) {
  const finish = Promise.withResolvers<undefined>();
  const seen: string[] = [];
  const answer = (text: string) => (request: ProviderRequest) => {
    seen.push(request.messages.map((message) => message.content).join('\n'));

    return say(text)(request);
  };
  const scripted = routedProvider({
    review: [
      calls(
        toolCall({ id: 'a', name: 'start_agent', input: { title: 'Review', task: 'review it' } }),
      ),
      say('It is working; ask me anything meanwhile.'),
      answer('Sure.'),
      answer('It found a bug.'),
    ],
    'review it': [say('Findings: a bug in parse()')],
  });
  const provider: Provider = {
    async *stream(request) {
      if (request.messages[0]?.content === 'review it') await finish.promise;
      yield* scripted.stream(request);
    },
  };
  const harness = createHarness({ provider, title: 'Review' });
  const tool = createSubAgentTool({ ...harness, runAgent: runSession, tools: [] });
  const conversation = createConversation({
    harness,
    run: streamAgent,
    tools: [tool],
    ...(options.waitForTasks !== undefined && { waitForTasks: options.waitForTasks }),
  });
  const prompt = async (text: string) => {
    const events: AgentEvent[] = [];

    for await (const event of conversation.send(text)) events.push(event);

    return events;
  };

  return { harness, conversation, prompt, finish, seen, tool };
}

describe('a sub-agent while the user keeps chatting', () => {
  it('lets the user chat while it works, and delivers its reply with their next message, never on its own', async () => {
    const { harness, conversation, prompt, finish, seen, tool } = conversationWithSlowSubAgent();

    try {
      // What the model is told about the reply is true in a chat and when a run waits.
      expect(tool.description).toContain('held until the next message the user sends');
      expect(tool.description).toContain('you are not woken for it on your own');
      expect(tool.description).toContain('If this run waits for background tasks');

      const started = await prompt('review');

      expect(started.at(-1)).toMatchObject({ type: 'done', reason: 'completed' });
      expect(conversation.running).toBe(false);
      expect(harness.tasks.runningCount).toBe(1);

      // The model is told its reply comes with the next turn, not that it will be woken for it.
      const told = conversation.messages.find((message) => message.role === 'tool')?.content;

      expect(told).toContain('reaches you at your next turn');
      expect(told).not.toMatch(/woken|end your turn and wait/);

      // The sub-agent is still working, and the user is not refused (`session_running`).
      const meanwhile = await prompt('anything else?');

      expect(meanwhile.at(-1)).toMatchObject({ type: 'done', reason: 'completed' });
      expect(seen).toHaveLength(1);
      expect(seen[0]).not.toContain('a bug in parse()');

      // It finishes while the conversation is idle: nothing wakes the model, the reply waits.
      finish.resolve(undefined);
      await until(() => harness.tasks.runningCount === 0);
      // Give a wrongly woken model time to be called before saying that it was not.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(seen).toHaveLength(1);
      expect(harness.tasks.hasUnreported).toBe(true);

      // The user's next turn is what brings it into the chat.
      const next = await prompt('what did it find?');

      expect(seen).toHaveLength(2);
      expect(seen[1]).toContain('Findings: a bug in parse()');
      expect(next.filter((event) => event.type === 'task_completed')).toHaveLength(1);
      expect(harness.tasks.hasUnreported).toBe(false);
    } finally {
      finish.resolve(undefined);
      await conversation.close();
    }
  });

  it('only keeps a prompt busy for it when the host opts in with waitForTasks', async () => {
    const { harness, conversation, finish, seen } = conversationWithSlowSubAgent({
      waitForTasks: true,
    });
    const events: AgentEvent[] = [];
    const running = (async () => {
      for await (const event of conversation.send('review')) events.push(event);
    })();

    try {
      await until(() => events.filter((event) => event.type === 'turn_end').length === 2);
      // Busy for the sub-agent: the user can't chat until it is done.
      expect(() => conversation.send('anything else?')).toThrow('A prompt is still running');
      finish.resolve(undefined);
      await running;
      expect(seen[0]).toContain('Findings: a bug in parse()');
      expect(harness.tasks.runningCount).toBe(0);
    } finally {
      finish.resolve(undefined);
      await running;
      await conversation.close();
    }
  });
});
