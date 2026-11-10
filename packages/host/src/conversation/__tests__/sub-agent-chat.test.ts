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
      say('It is working; waiting for its reply.'),
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

describe('sub-agent completion in a conversation', () => {
  it('keeps an interrupted prompt idle and delivers unfinished replies on the next user message', async () => {
    const { harness, conversation, prompt, finish, seen, tool } = conversationWithSlowSubAgent();

    try {
      expect(tool.description).toContain('comes to you automatically');
      expect(tool.description).toContain('you will be woken with the reply');
      const stop = new AbortController();
      const started: AgentEvent[] = [];

      for await (const event of conversation.send('review', { signal: stop.signal })) {
        started.push(event);
        if (event.type === 'turn_end' && event.turn === 2) stop.abort();
      }

      expect(started.at(-1)).toMatchObject({ type: 'done', reason: 'interrupted' });
      expect(conversation.running).toBe(false);
      expect(harness.tasks.runningCount).toBe(1);

      const told = conversation.messages.find((message) => message.role === 'tool')?.content;

      expect(told).toContain('Its complete report comes to you automatically');

      // It finishes while the conversation is idle: nothing wakes the model, the reply waits.
      finish.resolve(undefined);
      await until(() => harness.tasks.runningCount === 0);
      // Give a wrongly woken model time to be called before saying that it was not.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(seen).toHaveLength(0);
      expect(harness.tasks.hasUnreported).toBe(true);

      // The user's next turn is what brings it into the chat.
      const next = await prompt('what did it find?');

      expect(seen).toHaveLength(1);
      expect(seen[0]).toContain('Findings: a bug in parse()');
      expect(next.filter((event) => event.type === 'task_completed')).toHaveLength(1);
      expect(harness.tasks.hasUnreported).toBe(false);
    } finally {
      finish.resolve(undefined);
      await conversation.close();
    }
  });

  it.each([false, true])(
    'keeps a prompt alive for sub-agents with waitForTasks: %s',
    async (waitForTasks) => {
      const { harness, conversation, finish, seen } = conversationWithSlowSubAgent({
        waitForTasks,
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
    },
  );
});
