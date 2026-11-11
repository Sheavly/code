import { setTimeout } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
import { streamAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import { routedProvider, say } from '@sheavly/testing/provider/routed-provider.fake';
import { until } from '@sheavly/testing/wait/until.fake';
import { createHarness } from '../../host/host.helper.js';
import { createConversation } from '../conversation.helper.js';

/** The task cannot finish until the test releases it, independently of model turns. */
function conversationWithTask(backgroundKind?: 'task' | 'service') {
  const finish = Promise.withResolvers<undefined>();
  const seen: ProviderRequest[] = [];
  const answer = (request: ProviderRequest) => {
    seen.push(request);

    return say('The build passed.')(request);
  };
  const harness = createHarness({
    title: 'Build',
    provider: routedProvider({ build: [say('Waiting for the build.'), answer, answer] }),
  });

  harness.tasks.start({
    command: 'build',
    description: 'Build the project',
    sessionId: harness.mainSession.id,
    ...(backgroundKind && { backgroundKind }),
    run: async ({ onOutput }) => {
      await finish.promise;
      onOutput('Build passed');

      return { exitCode: 0 };
    },
  });

  const conversation = createConversation({ harness, run: streamAgent, tools: [] });

  return { harness, conversation, finish, seen };
}

/** Drive one prompt concurrently so the test can steer or release its finite work. */
function startBuild(conversation: ReturnType<typeof createConversation>) {
  const events: AgentEvent[] = [];
  const running = (async () => {
    for await (const event of conversation.send('build')) events.push(event);
  })();

  return { events, running };
}

/** Unlike the manually released build, this work must be stopped by lifecycle cleanup. */
function conversationWithCancellableWork(params: {
  backgroundKind: 'task' | 'service';
  stop?: AbortController;
}) {
  const { backgroundKind, stop } = params;
  const harness = createHarness({
    title: 'Build',
    provider: routedProvider({ build: [say('Waiting for the build.')] }),
  });

  harness.tasks.start({
    command: 'build',
    description: 'Build the project',
    sessionId: harness.mainSession.id,
    backgroundKind,
    run: async ({ signal }) => {
      await setTimeout(60_000, undefined, { signal });

      return { exitCode: 0 };
    },
  });

  const conversation = createConversation({
    harness,
    run: streamAgent,
    tools: [],
    // A service-only run can finish before its turn_end reaches the consumer.
    hooks: [defineHook({ name: 'interrupt-active-prompt', afterTurn: async () => stop?.abort() })],
  });

  return { harness, conversation };
}

describe('background task lifecycle in a conversation', () => {
  it.each(['task', 'service'] as const)('cancels a %s when its prompt is aborted', async (kind) => {
    const stop = new AbortController();
    const { harness, conversation } = conversationWithCancellableWork({
      backgroundKind: kind,
      stop,
    });
    const events: AgentEvent[] = [];

    try {
      for await (const event of conversation.send('build', { signal: stop.signal })) {
        events.push(event);
      }

      expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'interrupted' });
      expect(harness.tasks.list()).toMatchObject([{ status: 'cancelled' }]);
      expect(harness.tasks.runningCount).toBe(0);
      expect(conversation.running).toBe(false);
      expect(harness.sessions.get(harness.mainSession.id)?.state).toBe('idle');
    } finally {
      await conversation.close();
    }
  });

  it('cancels an outliving service when the conversation closes', async () => {
    const { harness, conversation } = conversationWithCancellableWork({
      backgroundKind: 'service',
    });

    try {
      for await (const _event of conversation.send('build'));

      expect(harness.tasks.runningCount).toBe(1);
      await conversation.close();
      expect(harness.tasks.list()).toMatchObject([{ status: 'cancelled' }]);
      expect(harness.tasks.runningCount).toBe(0);
      expect(harness.sessions.get(harness.mainSession.id)?.state).toBe('completed');
    } finally {
      await conversation.close();
    }
  });
  it('keeps a prompt active for finite work by default and delivers its completion', async () => {
    const { harness, conversation, finish, seen } = conversationWithTask();
    const { events, running } = startBuild(conversation);

    try {
      await until(() => events.some((event) => event.type === 'turn_end'));
      expect(conversation.running).toBe(true);
      expect(events.some((event) => event.type === 'done')).toBe(false);
      expect(() => conversation.send('next')).toThrow('A prompt is still running');
      finish.resolve(undefined);
      await running;
      expect(seen).toHaveLength(1);
      expect(seen[0]?.messages.map((message) => message.content).join('\n')).toContain(
        'Build passed',
      );
      expect(events.filter((event) => event.type === 'task_completed')).toHaveLength(1);
      expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'completed' });
      expect(harness.tasks.runningCount).toBe(0);
    } finally {
      finish.resolve(undefined);
      await running;
      await conversation.close();
    }
  });

  it('ends a prompt that waits on a finite task when asked to yield, leaving the task running', async () => {
    const { harness, conversation, finish } = conversationWithTask();
    const { events, running } = startBuild(conversation);

    try {
      await until(() => harness.sessions.inboxWaiters(harness.mainSession.id) > 0);
      expect(conversation.yieldPrompt()).toBe(true);
      await running;
      expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'completed' });
      expect(conversation.running).toBe(false);
      expect(harness.tasks.runningCount).toBe(1);
    } finally {
      finish.resolve(undefined);
      await running;
      await conversation.close();
    }
  });

  it.each(['after', 'at the same moment as'] as const)(
    'delivers a task result once to the next prompt when it finishes %s the yield',
    async (timing) => {
      const { harness, conversation, finish, seen } = conversationWithTask();
      const { events, running } = startBuild(conversation);

      try {
        await until(() => harness.sessions.inboxWaiters(harness.mainSession.id) > 0);

        if (timing === 'at the same moment as') finish.resolve(undefined);
        expect(conversation.yieldPrompt()).toBe(true);
        await running;
        expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'completed' });

        finish.resolve(undefined);
        await until(() => harness.tasks.hasUnreported);
        for await (const _event of conversation.send('what happened?'));

        const lastRequest = JSON.stringify(seen.at(-1)?.messages);

        expect(lastRequest).toContain('Build passed');
        expect(JSON.stringify(conversation.messages).split('Build passed')).toHaveLength(2);
        expect(harness.tasks.hasUnreported).toBe(false);
      } finally {
        finish.resolve(undefined);
        await conversation.close();
      }
    },
  );

  it('runs the next prompt before any automatic continuation from a task that finished while yielding', async () => {
    const { harness, conversation, finish, seen } = conversationWithTask();
    const { running } = startBuild(conversation);

    try {
      await until(() => harness.sessions.inboxWaiters(harness.mainSession.id) > 0);
      conversation.yieldPrompt();
      await running;
      finish.resolve(undefined);
      await until(() => harness.tasks.hasUnreported);

      // No model call happens on its own: the finished task waits for the next prompt.
      expect(conversation.running).toBe(false);
      expect(seen).toHaveLength(0);
      for await (const _event of conversation.send('what happened?'));
      expect(seen).toHaveLength(1);
    } finally {
      finish.resolve(undefined);
      await conversation.close();
    }
  });

  it('lets a service outlive a prompt without keeping it active', async () => {
    const { harness, conversation, finish, seen } = conversationWithTask('service');
    const events: AgentEvent[] = [];

    try {
      for await (const event of conversation.send('build')) events.push(event);

      expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'completed' });
      expect(conversation.running).toBe(false);
      expect(harness.tasks.runningCount).toBe(1);
      expect(seen).toHaveLength(0);
      finish.resolve(undefined);
      await until(() => harness.tasks.runningCount === 0);
      expect(harness.tasks.hasUnreported).toBe(true);

      for await (const _event of conversation.send('what happened?'));

      expect(seen).toHaveLength(1);
      expect(seen[0]?.messages.map((message) => message.content).join('\n')).toContain(
        'Build passed',
      );
      expect(harness.tasks.hasUnreported).toBe(false);
    } finally {
      finish.resolve(undefined);
      await conversation.close();
    }
  });
});
